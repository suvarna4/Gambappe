/**
 * Client-side (browser) fetch for `GET /api/v1/questions/tomorrow` (design-diff audit, §9.2
 * contract-change) — mirrors `duo-client.ts`'s use of `pick-client.ts`'s `request()`
 * envelope-unwrap/error-mapping, its own established pattern for a small single-route wrapper
 * rather than growing `pick-client.ts` itself. Public, no auth; `ViewerStrip` calls this once a
 * pick is on the board (see that file's effect) — a 404 (the common case when tomorrow hasn't
 * been curated yet) or any other failure is just "nothing to peek at" to the caller, same
 * best-effort posture as `fetchCurrentDuo`.
 */
import { getTomorrowQuestionResponseSchema } from '@receipts/core';
import type { z } from 'zod';
import { request, type ApiResult } from './pick-client';

type GetTomorrowQuestionResponse = z.infer<typeof getTomorrowQuestionResponseSchema>;

/** `GET /api/v1/questions/tomorrow` (§9.2, none). 404s `NOT_FOUND` when there's nothing safe to
 * peek at yet — callers treat that (and any other failure) as "show the flat banner instead." */
export function fetchTomorrowPeek(): Promise<ApiResult<GetTomorrowQuestionResponse>> {
  return request(
    '/api/v1/questions/tomorrow',
    { method: 'GET' },
    getTomorrowQuestionResponseSchema,
  );
}
