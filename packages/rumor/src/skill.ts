/**
 * RumorSkill — the versioned procedural memory (docs/plans/ws27-rumor-radar.md §3,
 * WS27-T3). Same philosophy as CpuMemory (packages/engine/src/cpu-memory.ts): a plain
 * versioned JSON blob with a `cutoff` audit stamp, pure functions around it, and bounded
 * tuning steps (WS27-T5) so no single saga can yank a knob. Everything tunable in the
 * pipeline lives HERE — the extractor and aggregator read their knobs from the skill,
 * never from module constants — so uploading/downloading the skill via xTrace moves the
 * entire learned behavior, with no redeploy.
 */
import { DEFAULT_STANCE_CUES } from './extract.js';
import type { NbaTeam } from './teams.js';

/** Bounded tuning: a knob moves at most this fraction of its range per tune call (T5). */
export const RUMOR_TUNE_MAX_STEP = 0.1;

export interface RumorSkill {
  version: 1;
  /** Newest data this skill has trained on (YYYY-MM-DD) — the audit stamp. */
  cutoff: string;
  /** Alias → team additions/overrides layered onto the built-in lexicon (extractor). */
  lexiconDeltas: Record<string, NbaTeam>;
  /** Cue phrase → signed weight, replacing DEFAULT_STANCE_CUES wholesale (extractor). */
  stanceCueWeights: Record<string, number>;
  /** Upvote exponent α in weight = log1p(upvotes)^α. */
  upvoteAlpha: number;
  /** Multiplier applied when the comment sits in the mentioned team's own fan sub. */
  homerDiscount: number;
  /** Half-life (days) of comment recency decay. */
  recencyHalfLifeDays: number;
  /** Share temperature: 1 = proportional shares; <1 sharpens; >1 flattens. */
  temperature: number;
  /** Per-saga training record: sagaId → replay summary (written by T4/T5). */
  record: Record<string, { logLoss: number; days: number; outcome: NbaTeam }>;
}

/**
 * The UNTRAINED baseline — pinned by test. Every trained-vs-untrained comparison in T4/T5
 * measures against exactly this skill, so its values must never drift silently.
 */
export function defaultRumorSkill(cutoff: string): RumorSkill {
  return {
    version: 1,
    cutoff,
    lexiconDeltas: {},
    stanceCueWeights: { ...DEFAULT_STANCE_CUES },
    upvoteAlpha: 1,
    homerDiscount: 0.5,
    recencyHalfLifeDays: 7,
    temperature: 1,
    record: {},
  };
}

/** Structural validation for skills loaded from disk or xTrace — never trust a blob. */
export function isRumorSkill(value: unknown): value is RumorSkill {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Record<string, unknown>;
  if (s['version'] !== 1) return false;
  if (typeof s['cutoff'] !== 'string') return false;
  if (typeof s['lexiconDeltas'] !== 'object' || s['lexiconDeltas'] === null) return false;
  if (typeof s['stanceCueWeights'] !== 'object' || s['stanceCueWeights'] === null) return false;
  if (typeof s['upvoteAlpha'] !== 'number' || s['upvoteAlpha'] <= 0) return false;
  if (typeof s['homerDiscount'] !== 'number' || s['homerDiscount'] < 0) return false;
  if (typeof s['recencyHalfLifeDays'] !== 'number' || s['recencyHalfLifeDays'] <= 0) return false;
  if (typeof s['temperature'] !== 'number' || s['temperature'] <= 0) return false;
  if (typeof s['record'] !== 'object' || s['record'] === null) return false;
  return Object.values(s['stanceCueWeights'] as Record<string, unknown>).every(
    (w) => typeof w === 'number',
  );
}
