/**
 * Nemesis pairing API schemas (design doc §9.2, §9.3 masking, §5.5, §8.8).
 */
import { z } from 'zod';
import { MARKET_SIDE, PAIRING_STATUS, PICK_RESULT, QUESTION_KIND, REMATCH_STATUS } from '../enums.js';
import { zPairingId, zProfileId, zQuestionId, zRematchRequestId, zSeasonId } from '../ids.js';
import { listEnvelopeSchema, paginationQuerySchema, zDateOnly, zSlug, zTimestamp } from './common.js';
import { profileRefSchema } from './profiles.js';

/**
 * One shared question on the pairing scoreboard. Opponent picks on a shared question are
 * masked (null) until that question locks (§9.3); pre-reveal daily results are masked too.
 */
export const pairingScoreboardRowSchema = z.object({
  question_id: zQuestionId,
  slug: zSlug,
  kind: z.enum(QUESTION_KIND),
  question_date: zDateOnly.nullable(),
  a: z
    .object({ side: z.enum(MARKET_SIDE), result: z.enum(PICK_RESULT).nullable() })
    .nullable(),
  b: z
    .object({ side: z.enum(MARKET_SIDE), result: z.enum(PICK_RESULT).nullable() })
    .nullable(),
});

/** Public matchup shape (both handles, daily-by-daily scoreboard, narration line — §9.2). */
export const pairingPublicSchema = z.object({
  id: zPairingId,
  season_id: zSeasonId,
  week_start: zDateOnly,
  status: z.enum(PAIRING_STATUS),
  is_rematch: z.boolean(),
  a: profileRefSchema,
  b: profileRefSchema,
  score: z.object({ a: z.number().int().nonnegative(), b: z.number().int().nonnegative() }),
  winner_profile_id: zProfileId.nullable(),
  narrative_line: z.string().nullable(),
  scoreboard: z.array(pairingScoreboardRowSchema),
});

// --- GET /pairings/current (claimed): my active pairing + scoreboard --------------------------

export const getCurrentPairingRequestSchema = z.object({});
export const getCurrentPairingResponseSchema = z.object({
  pairing: pairingPublicSchema.nullable(),
});

// --- GET /pairings/:id (none): public matchup page --------------------------------------------

export const getPairingRequestSchema = z.object({
  params: z.object({ id: zPairingId }),
});
export const getPairingResponseSchema = pairingPublicSchema;

// --- GET /me/nemesis-history (claimed): lifetime records vs past nemeses ----------------------

export const nemesisHistoryEntrySchema = z.object({
  pairing_id: zPairingId,
  season_id: zSeasonId,
  week_start: zDateOnly,
  opponent: profileRefSchema,
  my_score: z.number().int().nonnegative(),
  their_score: z.number().int().nonnegative(),
  outcome: z.enum(['win', 'loss', 'draw', 'cancelled']),
  is_rematch: z.boolean(),
});

export const getNemesisHistoryRequestSchema = z.object({ query: paginationQuerySchema });
export const getNemesisHistoryResponseSchema = listEnvelopeSchema(nemesisHistoryEntrySchema);

// --- Rematch requests (§9.2, §8.4 step 0) -----------------------------------------------------

export const rematchRequestSchema = z.object({
  id: zRematchRequestId,
  requester_profile_id: zProfileId,
  target_profile_id: zProfileId,
  season_id: zSeasonId,
  status: z.enum(REMATCH_STATUS),
  created_at: zTimestamp,
});

export const createRematchBodySchema = z
  .object({
    /** Target must be a past nemesis this season (§9.2). */
    target_profile_id: zProfileId,
  })
  .strict();

export const createRematchRequestSchema = z.object({ body: createRematchBodySchema });
export const createRematchResponseSchema = z.object({ request: rematchRequestSchema });

export const respondRematchRequestSchema = z.object({
  params: z.object({ id: zRematchRequestId }),
});
export const respondRematchResponseSchema = z.object({ request: rematchRequestSchema });
