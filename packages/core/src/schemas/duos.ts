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

export const getCurrentDuoRequestSchema = z.object({});
export const getCurrentDuoResponseSchema = z.object({
  duo: duoPublicSchema.nullable(),
  match: duoMatchPublicSchema.nullable(),
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
