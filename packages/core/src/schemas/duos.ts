/**
 * Duo API schemas (design doc §9.2, §8.5, §8.9–8.10). All duo surfaces are behind the
 * `duo_queue` flag (§4.6).
 */
import { z } from 'zod';
import { DUO_MATCH_STATUS, DUO_STATUS, QUEUE_STATUS } from '../enums.js';
import { zDuoId, zDuoMatchId, zDuoQueueEntryId } from '../ids.js';
import { listEnvelopeSchema, paginationQuerySchema, zDateOnly, zTimestamp } from './common.js';
import { profileRefSchema } from './profiles.js';

export const duoPublicSchema = z.object({
  id: zDuoId,
  status: z.enum(DUO_STATUS),
  tier: z.number().int().min(1),
  partners: z.tuple([profileRefSchema, profileRefSchema]),
  rating: z.object({
    glicko_rating: z.number(),
    glicko_rd: z.number(),
  }),
  matches_played: z.number().int().nonnegative(),
  /** §8.9; null until ≥ SYNERGY_MIN_PICKS graded slots. */
  joint_hit_rate: z.number().min(0).max(1).nullable(),
  synergy: z.number().nullable(),
});

export const duoMatchPublicSchema = z.object({
  id: zDuoMatchId,
  duo_a_id: zDuoId,
  duo_b_id: zDuoId,
  window_start: zDateOnly,
  window_end: zDateOnly,
  status: z.enum(DUO_MATCH_STATUS),
  score: z.object({ a: z.number().int().nonnegative(), b: z.number().int().nonnegative() }),
  winner_duo_id: zDuoId.nullable(),
});

// --- POST /duo/queue (claimed; eligibility checked) · DELETE /duo/queue -----------------------

export const enqueueDuoRequestSchema = z.object({});
export const enqueueDuoResponseSchema = z.object({
  entry: z.object({
    id: zDuoQueueEntryId,
    status: z.enum(QUEUE_STATUS),
    enqueued_at: zTimestamp,
  }),
});

export const dequeueDuoRequestSchema = z.object({});
export const dequeueDuoResponseSchema = z.object({ left: z.literal(true) });

// --- GET /duo/current (claimed): my duo + active match ----------------------------------------

/**
 * SW10-T3 (wiring-gaps doc §4 SW10-T3): the sealed partner chip's data — existence + timing
 * only, NEVER the partner's side (§9.3 stays untouched; the chip has no "unsealed" state). Null
 * when there's no active duo to report on; `{picked: false, picked_at: null}` when there is one
 * but "today's" daily question either doesn't exist yet or the partner hasn't picked it.
 * `picked_at` is truncated to minute precision, matching §9.2's public pick-timestamp posture
 * (`pickPublicSchema`'s own doc comment).
 */
export const partnerPickTodaySchema = z.object({
  picked: z.boolean(),
  picked_at: zTimestamp.nullable(),
});

export const getCurrentDuoRequestSchema = z.object({});
export const getCurrentDuoResponseSchema = z.object({
  duo: duoPublicSchema.nullable(),
  match: duoMatchPublicSchema.nullable(),
  /** SW10-T3 contract-change: `.nullish()` (optional-or-null) per the contract-PR sequencing
   * rule (wiring-gaps doc §4/§9 finding 1, same as SW10-T1's `nemesis_flip`) — `fetchCurrentDuo`
   * (`apps/web/lib/duo-client.ts`) runtime-parses every response through this schema, so a
   * required key deployed ahead of the handler change would break the live duo hub. */
  partner_pick_today: partnerPickTodaySchema.nullish(),
});

// --- GET /duos/:id (none): public duo page ----------------------------------------------------

export const getDuoRequestSchema = z.object({
  params: z.object({ id: zDuoId }),
});
export const getDuoResponseSchema = z.object({
  duo: duoPublicSchema,
  match_history: z.array(duoMatchPublicSchema),
});

// --- GET /duo/ladder (none): tier standings, paginated ----------------------------------------

export const ladderEntrySchema = z.object({
  rank: z.number().int().min(1),
  tier: z.number().int().min(1),
  duo: duoPublicSchema,
  wins: z.number().int().nonnegative(),
});

export const getLadderRequestSchema = z.object({
  query: paginationQuerySchema.extend({
    tier: z.coerce.number().int().min(1).optional(),
  }),
});
export const getLadderResponseSchema = listEnvelopeSchema(ladderEntrySchema);

// --- POST /duos/:id/disband (member only; partner notified; unilateral §8.5) ------------------

export const disbandDuoRequestSchema = z.object({
  params: z.object({ id: zDuoId }),
});
export const disbandDuoResponseSchema = z.object({ disbanded: z.literal(true) });
