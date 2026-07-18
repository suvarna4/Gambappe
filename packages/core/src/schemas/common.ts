/**
 * Shared schema primitives (design doc §9.1 conventions).
 * All API JSON uses snake_case keys; timestamps are ISO-8601 UTC strings.
 */
import { z } from 'zod';
import { PAGINATION_MAX_LIMIT } from '../config.js';

/** ISO timestamp in responses (timestamptz UTC serialized). */
export const zTimestamp = z.string().datetime({ offset: true });

/** Calendar date (`question_date`, `week_start`, ...). */
export const zDateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

/** Probability / price in [0,1] (numeric(6,5) in DB → number in TS, §4.3). */
export const zProbability = z.number().min(0).max(1);

/** URL slug (questions, profiles): lowercase alnum + `-` (§5.2). */
export const zSlug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'invalid slug');

/** Cursor pagination query (§9.1): `?cursor=&limit=`, limit max 50. */
export const paginationQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(PAGINATION_MAX_LIMIT).optional(),
});

export const paginationMetaSchema = z.object({
  next_cursor: z.string().nullable(),
});

/** `{data, meta?}` list envelope (§9.1). */
export function listEnvelopeSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    data: z.array(item),
    meta: paginationMetaSchema,
  });
}

/** Empty request shape (GET endpoints without params). */
export const emptyRequestSchema = z.object({});

/** Simple acknowledgement responses. */
export const okResponseSchema = z.object({ ok: z.literal(true) });
