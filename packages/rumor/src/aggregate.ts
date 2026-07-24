/**
 * Upvote weighting + crowd-odds aggregation (docs/plans/ws27-rumor-radar.md §2C,
 * WS27-T3). Pure functions from snapshots + a RumorSkill to a probability distribution
 * over candidate teams. Every knob comes from the skill; nothing here is tunable by code.
 *
 * weight = log1p(max(0, upvotes))^α · homerDiscount(sub, team) · 0.5^(ageDays/halfLife)
 *
 * Per team: raw = Σ stance·confidence·weight, floored at a small epsilon of total mass
 * (a team the crowd only ever talks DOWN gets a floor share, not a negative
 * probability). Shares are then power-normalized with temperature τ:
 * p_i ∝ raw_i^(1/τ) — equivalently softmax over log-raw — so τ=1 gives proportional
 * shares (the plan's validated naive-v0 behavior), τ<1 sharpens toward the leader,
 * τ>1 flattens toward uniform. Power normalization is scale-invariant: doubling every
 * raw score changes nothing, which softmax over raw sums would not survive.
 *
 * The recency clock is `asOf` — a parameter, never Date.now() — so the same corpus
 * replayed at day D always produces the same odds (the WS27-T4 walk-forward contract).
 */
import { extractTeamStances } from './extract.js';
import type { PostSnapshot } from './snapshot.js';
import { TEAM_SUBREDDITS } from './teams.js';
import type { NbaTeam } from './teams.js';
import type { RumorSkill } from './skill.js';

/** Floor share of total positive mass granted to an all-negative/unmentioned candidate. */
export const RAW_FLOOR_EPSILON = 0.005;

const DAY_S = 86_400;

/** One weighable unit of crowd evidence: a comment, or the post title+selftext itself. */
export interface CrowdEntry {
  text: string;
  /** Upvotes at capture. */
  score: number;
  subreddit: string;
  /** Unix seconds. */
  createdUtc: number;
}

export interface CrowdOdds {
  /** Recency anchor the odds were computed at (unix seconds). */
  asOf: number;
  odds: Record<NbaTeam, number>;
  /** Pre-normalization signed mass per candidate — the demo's audit trail. */
  raw: Record<NbaTeam, number>;
  /** Entries that mentioned at least one candidate team. */
  entriesUsed: number;
  entriesTotal: number;
}

/** A snapshot as weighable entries: the post text first, then every comment. */
export function snapshotEntries(snapshot: PostSnapshot): CrowdEntry[] {
  const post: CrowdEntry = {
    text: `${snapshot.post.title}\n${snapshot.post.selftext}`,
    score: snapshot.post.score,
    subreddit: snapshot.post.subreddit,
    createdUtc: snapshot.post.createdUtc,
  };
  return [
    post,
    ...snapshot.comments.map((c) => ({
      text: c.body,
      score: c.score,
      subreddit: snapshot.post.subreddit,
      createdUtc: c.createdUtc,
    })),
  ];
}

/** The plan §2C weight formula. Future evidence (createdUtc > asOf) weighs zero. */
export function entryWeight(
  entry: Pick<CrowdEntry, 'score' | 'subreddit' | 'createdUtc'>,
  team: NbaTeam,
  skill: RumorSkill,
  asOf: number,
): number {
  const ageDays = (asOf - entry.createdUtc) / DAY_S;
  if (ageDays < 0) return 0;
  const upvote = Math.log1p(Math.max(0, entry.score)) ** skill.upvoteAlpha;
  const homer = TEAM_SUBREDDITS[team].includes(entry.subreddit.toLowerCase())
    ? skill.homerDiscount
    : 1;
  const recency = 0.5 ** (ageDays / skill.recencyHalfLifeDays);
  return upvote * homer * recency;
}

/**
 * Aggregate entries into crowd odds over `candidates`. Mentions of non-candidate teams
 * are ignored — the question is "which of THESE destinations", matching how the market
 * frames it. Deterministic: same entries, skill, candidates, and asOf → same odds.
 */
export function aggregateCrowdOdds(
  entries: readonly CrowdEntry[],
  skill: RumorSkill,
  candidates: readonly NbaTeam[],
  asOf: number,
): CrowdOdds {
  const raw: Partial<Record<NbaTeam, number>> = {};
  let entriesUsed = 0;

  for (const entry of entries) {
    if (entry.createdUtc > asOf) continue;
    const stances = extractTeamStances(entry.text, {
      extraAliases: skill.lexiconDeltas,
      cueWeights: skill.stanceCueWeights,
    });
    let used = false;
    for (const { team, stance, confidence } of stances) {
      if (!candidates.includes(team)) continue;
      raw[team] = (raw[team] ?? 0) + stance * confidence * entryWeight(entry, team, skill, asOf);
      used = true;
    }
    if (used) entriesUsed += 1;
  }

  const positiveMass = candidates.reduce((s, t) => s + Math.max(0, raw[t] ?? 0), 0);
  // A corpus with zero positive signal (or before any evidence exists) is genuinely
  // uninformative: uniform over candidates, not NaN.
  const floor = positiveMass > 0 ? positiveMass * RAW_FLOOR_EPSILON : 1;
  const powered = candidates.map((t) => Math.max(raw[t] ?? 0, floor) ** (1 / skill.temperature));
  const total = powered.reduce((s, v) => s + v, 0);

  const odds = {} as Record<NbaTeam, number>;
  const rawOut = {} as Record<NbaTeam, number>;
  candidates.forEach((t, i) => {
    odds[t] = powered[i]! / total;
    rawOut[t] = raw[t] ?? 0;
  });

  return { asOf, odds, raw: rawOut, entriesUsed, entriesTotal: entries.length };
}
