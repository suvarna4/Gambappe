/**
 * Question API schemas (design doc §9.2 GET /questions/*, §6.7 RevealPayload, §9.3 hiding rules).
 */
import { z } from 'zod';
import {
  MARKET_SIDE,
  PICK_RESULT,
  QUESTION_KIND,
  QUESTION_STATUS,
  VENUE,
} from '../enums.js';
import { zQuestionId } from '../ids.js';
import { zDateOnly, zProbability, zSlug, zTimestamp } from './common.js';
import { pickSchema } from './picks.js';

/** Crowd split — only ever present once the question is locked (§9.3: hidden while `open`). */
export const crowdSplitSchema = z.object({
  yes: z.number().int().nonnegative(),
  no: z.number().int().nonnegative(),
  pct_yes: z.number().min(0).max(100),
});

/**
 * Public question shape (§9.2): state, headline, labels, live price, crowd split (null until
 * lock per §9.3), lock/reveal times. `status` is the EFFECTIVE state derived from timestamps
 * (§5.7 effective-state rule), not the raw column.
 */
export const questionPublicSchema = z.object({
  id: zQuestionId,
  slug: zSlug,
  kind: z.enum(QUESTION_KIND),
  status: z.enum(QUESTION_STATUS),
  question_date: zDateOnly.nullable(),
  headline: z.string(),
  blurb: z.string().nullable(),
  yes_label: z.string(),
  no_label: z.string(),
  open_at: zTimestamp,
  lock_at: zTimestamp,
  reveal_at: zTimestamp,
  /** Live venue yes-price (the receipt price; shown even while open — §9.3 rationale). */
  yes_price: zProbability.nullable(),
  yes_price_updated_at: zTimestamp.nullable(),
  /** Null while `open` — no exceptions (§9.3). Snapshot values once locked. */
  crowd: crowdSplitSchema.nullable(),
  /** Set on revealed questions only (§9.2). */
  outcome: z.enum(MARKET_SIDE).nullable(),
  revealed_at: zTimestamp.nullable(),
  void_reason: z.string().nullable(),
  is_volatile: z.boolean(),
  /** Outbound deep link material (§7.8). */
  venue: z.enum(VENUE),
  venue_url: z.string().url(),
});

export type QuestionPublic = z.infer<typeof questionPublicSchema>;

// --- GET /questions/today ---------------------------------------------------------------------

export const getTodayQuestionRequestSchema = z.object({});
export const getTodayQuestionResponseSchema = questionPublicSchema;

// --- GET /questions/:slug ---------------------------------------------------------------------

export const getQuestionRequestSchema = z.object({
  params: z.object({ slug: zSlug }),
});
export const getQuestionResponseSchema = questionPublicSchema;

// --- GET /questions/:slug/reveal (§6.7 RevealPayload; 423 REVEAL_NOT_READY pre-reveal) --------

/** Viewer streak block within the reveal payload. */
export const revealStreakSchema = z.object({
  current: z.number().int().nonnegative(),
  best: z.number().int().nonnegative(),
  delta: z.number().int(),
  freeze_used: z.boolean(),
});

export const revealViewerSchema = z.object({
  pick: pickSchema,
  result: z.enum(PICK_RESULT),
  edge: z.number().nullable(),
  /** Nullable BY CONTRACT (§6.7): always null at P0 (pre WS3-T5); UI omits the stat. */
  percentile: z.number().min(0).max(100).nullable(),
  streak: revealStreakSchema,
  badges: z.array(z.literal('called_it')),
});

export const revealShareSchema = z.object({
  page_url: z.string().url(),
  og_url: z.string().url(),
  card_urls: z.array(z.string().url()),
});

/** RevealPayload (§6.7). The `viewer` block is fetched client-side (§10.2 keeps SSR viewer-free). */
export const revealPayloadSchema = z.object({
  question: questionPublicSchema,
  outcome: z.enum(MARKET_SIDE),
  crowd: crowdSplitSchema,
  viewer: revealViewerSchema.optional(),
  narrative_line: z.string(),
  share: revealShareSchema,
});

export const getRevealRequestSchema = z.object({
  params: z.object({ slug: zSlug }),
});
export const getRevealResponseSchema = revealPayloadSchema;
