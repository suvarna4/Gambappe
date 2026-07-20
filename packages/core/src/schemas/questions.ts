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
import { zPickId, zQuestionId } from '../ids.js';
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

// --- GET /questions/tomorrow (design-diff audit vs. docs/mockups/swipe-ux.html + the
//     `docs/swipe-ux-plan.md` §2.5 "under-card" AC — contract-change) ---------------------------

/**
 * The "peeking next-day card" (swipe-ux-plan §2.5: "the stage, rails, under-card ... render in
 * the server shell"; §2.5's under-card bullet: "tomorrow's `scheduled` question when published
 * (headline hidden — shows only 'TOMORROW · opens 9:00 ET'), else a blank slip. Never
 * interactive."). Deliberately the narrowest possible shape — NOT `questionPublicSchema` — for
 * two independent reasons: (1) `questionPublicSchema.yes_price` is populated regardless of
 * status (§9.3 only gates `crowd`), so reusing it verbatim here would leak the venue price for a
 * question that hasn't opened; (2) the design intentionally hides the headline pre-open (above),
 * so there's nothing else safe to carry. `status` is pinned to the literal `'scheduled'` — the
 * ONLY state this endpoint ever serves; an already-open/locked/revealed "next daily" isn't
 * "tomorrow, unopened" anymore, and `GET /questions/tomorrow` 404s instead of shipping a shape
 * for that (§9.2).
 */
export const questionPeekSchema = z.object({
  status: z.literal('scheduled'),
  open_at: zTimestamp,
});

export type QuestionPeek = z.infer<typeof questionPeekSchema>;

export const getTomorrowQuestionRequestSchema = z.object({});
export const getTomorrowQuestionResponseSchema = questionPeekSchema;

// --- GET /questions/:slug ---------------------------------------------------------------------

export const getQuestionRequestSchema = z.object({
  params: z.object({ slug: zSlug }),
});
export const getQuestionResponseSchema = questionPublicSchema;

// --- GET /questions/:slug/reveal (§6.7 RevealPayload; 423 REVEAL_NOT_READY pre-reveal) --------

/**
 * "Died holding …" — the dead run's final ANSWERED pick (SW9-T1, obituary-handoff §3.1/§3.2).
 * The run's `ended_on` can be a date the viewer never picked (a contiguous voided day, or a
 * freeze-covered missed day, both of which extend the run), so this is the latest answered
 * daily <= `ended_on` within the run — never "the pick on `ended_on`". Null when unresolvable;
 * the UI then omits the line (SW4-T1 degrade rule).
 */
export const brokenRunLastPickSchema = z.object({
  /** The viewer's own pick — powers the obituary share path (SW9-T2). */
  pick_id: zPickId,
  /** The death question's label for the held side ("Died holding {SIDE}"). */
  side_label: z.string(),
  /** Implied entry price of the held side, in cents ("@ {c}¢"). */
  entry_cents: z.number().int().min(0).max(100),
  /** Slug of the question the pick was on — the share path's landing page (SW9-T2). */
  question_slug: zSlug,
});

/**
 * The viewer's most recently completed (broken) participation run (SW9-T1, obituary-handoff
 * §3.2). Emitted iff this reveal is the "wake" — the viewer's first counted daily since the
 * break: `runs.length > 0 && currentRunStartedOn === question_date` on the through-
 * `question_date` replay. No length threshold server-side — the contract carries the fact;
 * `OBITUARY_MIN_STREAK` (packages/ui) stays a client presentation rule.
 */
export const brokenRunSchema = z.object({
  /** Counted days of the dead run — always >= 1 (§3.1 zero-guard). */
  length: z.number().int().positive(),
  /** First counted (answered) date of the dead run. */
  started_on: zDateOnly,
  /** Last counted date (possibly voided/freeze-covered — NOT the missed day that killed it). */
  ended_on: zDateOnly,
  last_pick: brokenRunLastPickSchema.nullable(),
  /** Recorded freeze uses with covered date in (started_on, ended_on] — half-open (§3.1). */
  freezes_survived: z.number().int().nonnegative(),
  /** Cheapest implied entry (cents) among the run's answered picks; null if none resolvable. */
  longest_odds_cents: z.number().int().min(0).max(100).nullable(),
});

/** Viewer streak block within the reveal payload. */
export const revealStreakSchema = z.object({
  current: z.number().int().nonnegative(),
  best: z.number().int().nonnegative(),
  delta: z.number().int(),
  freeze_used: z.boolean(),
  /** Non-null only at the wake reveal (see `brokenRunSchema`) — SW9-T1 contract-change. */
  broken_run: brokenRunSchema.nullable(),
});

/**
 * The nemesis daily "flip" (SW10-T1, swipe-ux-plan §2.9; wiring-gaps doc §4 SW10-T1). Fires AT
 * REVEAL, not at pick time (the original pick-time trigger was found unimplementable without
 * violating §9.3's no-probe-by-picking rule — see the wiring-gaps doc §3/§9). Non-null iff the
 * viewer has an active nemesis pairing this week AND the opponent has a pick on this exact
 * question. `you_wins`/`opponent_wins` are derived by replaying the pairing's scoreboard rows
 * (never `nemesis_pairings.score_a`/`score_b`, which stay 0 until the week concludes).
 */
export const nemesisFlipSchema = z.object({
  opponent_handle: z.string(),
  opponent_side: z.enum(MARKET_SIDE),
  opponent_side_label: z.string(),
  /** Implied entry price of the opponent's HELD side, in integer cents. */
  opponent_entry_cents: z.number().int().min(0).max(100),
  /** One engine-narrated line (`nemesis_lead_taken`/`nemesis_comeback`), or null when no beat's
   * trigger condition is met / a required slot is unresolvable (degrade rule). */
  narration: z.string().nullable(),
  /** Head-to-head wins this week, viewer-relative. */
  you_wins: z.number().int().nonnegative(),
  opponent_wins: z.number().int().nonnegative(),
  /** e.g. "Week of Jul 06 · Day 2". */
  week_label: z.string(),
});

/**
 * The duo shared-deck tandem block (SW10-T3, swipe-ux-plan §2.9; wiring-gaps doc §4 SW10-T3).
 * Fires AT REVEAL, same corrected timing as SW10-T1's `nemesis_flip` (the original pick-time
 * trigger for the duo tandem line has the identical no-probe-by-picking problem — see that
 * task's note). Non-null iff the viewer has an active duo AND the partner has a pick on this
 * exact question. Fields match `DuoTandem`'s props (`apps/web/components/duo/DuoTandem.tsx`) —
 * the viewer's own side/label come from the payload's existing `viewer.pick` and the question's
 * `yes_label`/`no_label`, not carried again here.
 */
export const duoTandemSchema = z.object({
  partner_handle: z.string(),
  partner_side: z.enum(MARKET_SIDE),
  partner_side_label: z.string(),
});

export const revealViewerSchema = z.object({
  pick: pickSchema,
  result: z.enum(PICK_RESULT),
  edge: z.number().nullable(),
  /** Nullable BY CONTRACT (§6.7): always null at P0 (pre WS3-T5); UI omits the stat. */
  percentile: z.number().min(0).max(100).nullable(),
  streak: revealStreakSchema,
  badges: z.array(z.literal('called_it')),
  /** SW10-T1 contract-change: `.nullish()` (optional-or-null) per the contract-PR sequencing
   * rule (wiring-gaps doc §4/§9 finding 1) — the emitter and this field ship together here, but
   * `.nullish()` is kept rather than tightened to `.nullable()` to match the doc's pinned shape. */
  nemesis_flip: nemesisFlipSchema.nullish(),
  /** SW10-T3 contract-change: same `.nullish()` sequencing rule as `nemesis_flip` above — a
   * different field on the same object, no shared line, nothing to actually coordinate. */
  duo_tandem: duoTandemSchema.nullish(),
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
