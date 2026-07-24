/**
 * The live saga + crowd-vs-market divergence (docs/plans/ws27-rumor-radar.md §2E,
 * WS27-T6). The live saga is UNRESOLVED — it deliberately does not fit SagaDef (no
 * outcome, no resolvedAt): nothing downstream can accidentally "grade" it before
 * reality does. Candidates are the teams Polymarket prices meaningfully plus the
 * incumbent; both distributions are normalized over exactly this set (see
 * polymarket.ts on why that's the only fair comparison).
 */
import type { CrowdOdds } from './aggregate.js';
import type { MarketOdds } from './polymarket.js';
import type { NbaTeam } from './teams.js';

export interface LiveSagaDef {
  id: string;
  player: string;
  titleQuery: string;
  subreddits: string[];
  candidates: NbaTeam[];
  /** Polymarket event the market side snapshots. */
  marketSlug: string;
}

export const LIVE_SAGA: LiveSagaDef = {
  id: 'lebron-2026',
  player: 'LeBron James',
  titleQuery: 'lebron',
  subreddits: ['nba', 'lakers', 'heat', 'clevelandcavs', 'warriors', 'sixers'],
  candidates: ['MIA', 'CLE', 'GSW', 'PHI', 'MIN', 'NYK', 'SAS', 'DEN', 'LAC', 'LAL'],
  marketSlug: 'nba-lebron-james-next-team',
};

export interface Divergence {
  /** crowd − market, per candidate (positive = Reddit believes more than money does). */
  delta: Record<NbaTeam, number>;
  /** KL(crowd ‖ market) in nats — total divergence headline. */
  kl: number;
  topCrowd: NbaTeam;
  topMarket: NbaTeam;
  agree: boolean;
}

export function divergence(
  crowd: CrowdOdds,
  market: MarketOdds,
  candidates: readonly NbaTeam[],
): Divergence {
  const delta = {} as Record<NbaTeam, number>;
  let kl = 0;
  const EPS = 1e-9;
  for (const t of candidates) {
    const p = crowd.odds[t] ?? 0;
    const q = market.odds[t] ?? 0;
    delta[t] = p - q;
    if (p > EPS) kl += p * Math.log(p / Math.max(q, EPS));
  }
  const top = (odds: Record<NbaTeam, number>): NbaTeam =>
    candidates.reduce((best, t) => ((odds[t] ?? 0) > (odds[best] ?? 0) ? t : best));
  const topCrowd = top(crowd.odds);
  const topMarket = top(market.odds);
  return { delta, kl, topCrowd, topMarket, agree: topCrowd === topMarket };
}

/** One committed odds-history line (data/live/odds-history.jsonl). */
export interface OddsHistoryRow {
  /** YYYY-MM-DD snapshot date (UTC). */
  date: string;
  /** Unix seconds the snapshot was taken. */
  asOf: number;
  /** Skill cutoff that produced the crowd odds ('none' when corpus was empty). */
  skillCutoff: string;
  crowd: Record<NbaTeam, number> | null;
  market: Record<NbaTeam, number>;
  vig: number;
  kl: number | null;
  entriesUsed: number;
  posts: number;
}

export function isOddsHistoryRow(value: unknown): value is OddsHistoryRow {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r['date'] === 'string' &&
    typeof r['asOf'] === 'number' &&
    typeof r['skillCutoff'] === 'string' &&
    (r['crowd'] === null || (typeof r['crowd'] === 'object' && r['crowd'] !== null)) &&
    typeof r['market'] === 'object' &&
    r['market'] !== null &&
    typeof r['vig'] === 'number' &&
    (r['kl'] === null || typeof r['kl'] === 'number') &&
    typeof r['entriesUsed'] === 'number' &&
    typeof r['posts'] === 'number'
  );
}
