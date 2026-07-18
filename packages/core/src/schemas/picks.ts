/**
 * Pick API schemas (design doc §6.2, §9.2).
 */
import { z } from 'zod';
import { MARKET_SIDE, PICK_RESULT, PICK_SOURCE } from '../enums.js';
import { zPickId, zProfileId, zQuestionId } from '../ids.js';
import { zProbability, zTimestamp } from './common.js';

/** A pick as returned to its owner. */
export const pickSchema = z.object({
  id: zPickId,
  question_id: zQuestionId,
  profile_id: zProfileId,
  side: z.enum(MARKET_SIDE),
  /** Live yes-price at pick time; implied prob of chosen side = side==='yes' ? p : 1−p (§5.3). */
  yes_price_at_entry: zProbability,
  price_stamped_at: zTimestamp,
  picked_at: zTimestamp,
  source: z.enum(PICK_SOURCE),
  confidence: z.number().int().min(50).max(100).nullable(),
  /** Publication rule (§6.5): presented as `pending` on graded-but-unrevealed dailies. */
  result: z.enum(PICK_RESULT),
  edge: z.number().nullable(),
});

export type Pick = z.infer<typeof pickSchema>;

/**
 * Public pick (profile pick logs, §9.2): `picked_at` is truncated to minute precision for
 * non-owners (sleep/location-profiling guard); no `profile_id`-adjacent private fields.
 */
export const pickPublicSchema = pickSchema.omit({ confidence: true });
export type PickPublic = z.infer<typeof pickPublicSchema>;

// --- POST /questions/:id/picks (§6.2) ---------------------------------------------------------

/**
 * Body per §6.2 step 1: `{side, age_attested?, confidence?}`.
 * `source` is NEVER client-supplied (§6.2 step 1 — derived server-side from the signed landing
 * context; the §9.2 table's `source?` is superseded by the normative §6.2 algorithm).
 * `confidence` is rejected unless flag `confidence_slider` is on (handler-enforced).
 */
export const createPickBodySchema = z
  .object({
    side: z.enum(MARKET_SIDE),
    /** Required (as literal true) when the profile has not yet attested 18+ (INV-9, step 0). */
    age_attested: z.literal(true).optional(),
    confidence: z.number().int().min(50).max(100).optional(),
  })
  .strict();

export const createPickRequestSchema = z.object({
  params: z.object({ id: zQuestionId }),
  body: createPickBodySchema,
});

/**
 * 201 response (§6.2 step 6): pick + stamped price + undo deadline.
 * NEVER includes crowd counts while the question is open (§9.3 — no probe-by-picking).
 */
export const createPickResponseSchema = z.object({
  pick: pickSchema,
  undo_until: zTimestamp,
});

// --- DELETE /picks/:id (undo, §6.2) -----------------------------------------------------------

export const deletePickRequestSchema = z.object({
  params: z.object({ id: zPickId }),
});

export const deletePickResponseSchema = z.object({
  deleted: z.literal(true),
});
