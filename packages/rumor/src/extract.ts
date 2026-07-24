/**
 * Deterministic per-comment stance extraction (docs/plans/ws27-rumor-radar.md §2B,
 * WS27-T2). Pure function over plain text: no I/O, no RNG, no model calls — every output
 * is reproducible and auditable, which is what makes the verification examples in the plan
 * checkable by a human. An LLM-based v2 could replace `extractTeamStances` behind the same
 * output shape without touching anything downstream.
 *
 * Semantics per alias occurrence:
 * - Stance cues in a ±CUE_WINDOW token window set the stance (signed weights, summed,
 *   clamped to [−1, 1]). "leaving the lakers" reads NEGATIVE for LAL — mention ≠
 *   destination belief; this is the exact failure the plan's naive-v0 exposed (LAL 4.8%
 *   vs market 0.4%).
 * - A bare mention with no cue is a WEAK positive (MENTION_BASE_STANCE) at low
 *   confidence — the v0 assumption, kept but demoted.
 * - A negator shortly BEFORE the alias flips the final stance ("not going to miami").
 * - A hypothetical marker before the alias halves confidence ("if he goes to boston").
 * - A trailing "/s" flips and halves every stance in the comment (sarcasm inverts the
 *   surface reading but is lower-signal than a straight assertion).
 *
 * All knobs (`cueWeights`, `extraAliases`) are injectable — the RumorSkill (WS27-T3)
 * feeds its learned `stanceCueWeights` / `lexiconDeltas` through these parameters.
 */
import { aliasesLongestFirst } from './lexicon.js';
import type { NbaTeam } from './teams.js';

export interface TeamStance {
  team: NbaTeam;
  /** Signed destination belief in [−1, 1]: +1 "he's going", −1 "he's not". */
  stance: number;
  /** How much this comment's evidence is worth before upvote weighting, in (0, 1]. */
  confidence: number;
}

/** Tokens on each side of an alias that count as its cue window. */
export const CUE_WINDOW = 6;
/** Tokens before an alias scanned for negators/hypotheticals. */
export const PRE_WINDOW = 4;
/** Stance of a bare mention (no cues) — weak destination association. */
export const MENTION_BASE_STANCE = 0.25;
/** Confidence of a bare mention. */
export const MENTION_BASE_CONFIDENCE = 0.35;

/**
 * Default stance-cue weights: phrase → signed weight. Multi-word phrases are matched as
 * token sequences inside the cue window. Overridden wholesale by the skill's
 * `stanceCueWeights` once training moves them (WS27-T3/T5).
 */
export const DEFAULT_STANCE_CUES: Record<string, number> = {
  // Destination-positive
  'going to': 0.7,
  'goes to': 0.6,
  'signing with': 0.9,
  'signs with': 0.9,
  'sign with': 0.7,
  'headed to': 0.7,
  'heading to': 0.7,
  'has agreed': 0.9,
  'agreed to': 0.8,
  joining: 0.7,
  joins: 0.7,
  'welcome to': 0.8,
  'done deal': 0.9,
  official: 0.6,
  confirmed: 0.6,
  committed: 0.6,
  staying: 0.7,
  stays: 0.7,
  're sign': 0.7,
  resign: 0.5,
  resigning: 0.5,
  'best fit': 0.5,
  favorite: 0.4,
  favorites: 0.4,
  frontrunner: 0.6,
  'front runner': 0.6,
  // Destination-negative
  leaving: -0.7,
  leaves: -0.6,
  left: -0.5,
  leverage: -0.7,
  smokescreen: -0.8,
  'smoke screen': -0.8,
  'not happening': -0.8,
  'ruled out': -0.9,
  'off the table': -0.8,
  'no cap space': -0.7,
  'no chance': -0.8,
  'no way': -0.7,
  'never happening': -0.8,
  eliminated: -0.7,
  'out of the running': -0.8,
  'passed on': -0.6,
  'moving on from': -0.6,
};

const NEGATORS = new Set([
  'not',
  'never',
  "won't",
  'wont',
  "wouldn't",
  'wouldnt',
  "isn't",
  'isnt',
  "doesn't",
  'doesnt',
  "ain't",
  'aint',
  "can't",
  'cant',
  'no',
]);

const HYPOTHETICALS = new Set(['if', 'unless', 'imagine', 'hypothetically', 'suppose']);

interface Token {
  text: string;
}

/**
 * Sentences are hard cue barriers: "…as leverage. Miami tanks…" must not hand Miami the
 * leverage cue from the previous sentence (a real fixture comment caught exactly this).
 */
function sentences(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[.!?;\n]+/)
    .filter((s) => s.trim().length > 0);
}

function tokenize(sentence: string): Token[] {
  return (
    sentence
      // Keep apostrophes inside words ("won't"); everything else splits.
      .split(/[^a-z0-9']+/)
      .filter((t) => t.length > 0)
      .map((t) => ({ text: t }))
  );
}

/** True when alias tokens match at position i (token-sequence match = word boundaries). */
function matchesAt(tokens: Token[], i: number, phrase: string[]): boolean {
  if (i + phrase.length > tokens.length) return false;
  for (let k = 0; k < phrase.length; k++) {
    if (tokens[i + k]!.text !== phrase[k]) return false;
  }
  return true;
}

function cueScoreAround(
  tokens: Token[],
  start: number,
  end: number,
  cues: Array<{ phrase: string[]; weight: number }>,
): { score: number; hits: number; cueTokens: Set<number> } {
  const lo = Math.max(0, start - CUE_WINDOW);
  const hi = Math.min(tokens.length, end + CUE_WINDOW);
  let score = 0;
  let hits = 0;
  // Positions consumed by matched cues: a "no" inside the cue "no chance" must not ALSO
  // fire as a standalone negator and flip the cue's own sign back (double negation bug).
  const cueTokens = new Set<number>();
  for (const cue of cues) {
    for (let i = lo; i + cue.phrase.length <= hi; i++) {
      // A cue overlapping the alias itself doesn't count.
      if (i < end && i + cue.phrase.length > start) continue;
      if (matchesAt(tokens, i, cue.phrase)) {
        score += cue.weight;
        hits += 1;
        for (let k = i; k < i + cue.phrase.length; k++) cueTokens.add(k);
      }
    }
  }
  return { score, hits, cueTokens };
}

export interface ExtractOptions {
  /** Skill lexicon deltas layered over the built-in aliases (WS27-T3). */
  extraAliases?: Record<string, NbaTeam>;
  /** Skill cue weights replacing DEFAULT_STANCE_CUES (WS27-T3). */
  cueWeights?: Record<string, number>;
}

/**
 * Extract per-team stances from one comment body. Returns one entry per mentioned team
 * (confidence-weighted mean across that team's occurrences), teams sorted by code for
 * determinism. Comments with no team signal return [] — most do, and that's correct.
 */
export function extractTeamStances(text: string, opts: ExtractOptions = {}): TeamStance[] {
  const aliases = aliasesLongestFirst(opts.extraAliases);
  const cues = Object.entries(opts.cueWeights ?? DEFAULT_STANCE_CUES).map(([phrase, weight]) => ({
    phrase: phrase.toLowerCase().split(' '),
    weight,
  }));
  // Checked against the raw text (tokenization strips the slash) so ordinary words
  // ending in "s" can never trigger it.
  const sarcasm = /(^|\s)\/s(\s|$)/.test(text.toLowerCase());

  const perTeam = new Map<NbaTeam, Array<{ stance: number; confidence: number }>>();

  for (const sentence of sentences(text)) {
    const tokens = tokenize(sentence);
    const consumed = new Set<number>();

    for (let i = 0; i < tokens.length; i++) {
      if (consumed.has(i)) continue;
      for (const { team, tokens: phrase } of aliases) {
        if (!matchesAt(tokens, i, phrase)) continue;
        const start = i;
        const end = i + phrase.length;
        for (let k = start; k < end; k++) consumed.add(k);

        const { score, hits, cueTokens } = cueScoreAround(tokens, start, end, cues);
        let stance: number;
        let confidence: number;
        if (hits === 0) {
          stance = MENTION_BASE_STANCE;
          confidence = MENTION_BASE_CONFIDENCE;
        } else {
          stance = Math.max(-1, Math.min(1, score));
          confidence = Math.min(0.9, 0.5 + 0.15 * hits);
        }

        for (let k = Math.max(0, start - PRE_WINDOW); k < start; k++) {
          if (NEGATORS.has(tokens[k]!.text) && !cueTokens.has(k)) {
            stance = -stance;
            break;
          }
        }
        for (let k = Math.max(0, start - PRE_WINDOW); k < start; k++) {
          if (HYPOTHETICALS.has(tokens[k]!.text)) {
            confidence *= 0.5;
            break;
          }
        }
        if (sarcasm) {
          stance = -stance * 0.5;
          confidence *= 0.5;
        }

        const list = perTeam.get(team) ?? [];
        list.push({ stance, confidence });
        perTeam.set(team, list);
        break;
      }
    }
  }

  const out: TeamStance[] = [];
  for (const [team, occurrences] of perTeam) {
    const mass = occurrences.reduce((s, o) => s + o.confidence, 0);
    const stance = occurrences.reduce((s, o) => s + o.stance * o.confidence, 0) / mass;
    const confidence = Math.min(
      0.95,
      Math.max(...occurrences.map((o) => o.confidence)) + 0.1 * (occurrences.length - 1),
    );
    out.push({ team, stance, confidence });
  }
  return out.sort((a, b) => a.team.localeCompare(b.team));
}
