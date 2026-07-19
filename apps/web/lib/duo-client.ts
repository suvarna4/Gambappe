/**
 * Client-side (browser) typed fetch wrappers for the duo hub (§8.5, §9.2, WS7-T7). Mirrors
 * `pick-client.ts`'s `request()` envelope-unwrap/error-mapping pattern (imported from there
 * rather than duplicated, same as `thread-client.ts`) — every route called here
 * (`POST`/`DELETE /duo/queue`, `GET /duo/current`, `POST /duos/:id/disband`) is real and
 * merged (WS6-T1/WS6-T4), behind the `duo_queue` flag (§4.6) at the API layer.
 */
import {
  dequeueDuoResponseSchema,
  disbandDuoResponseSchema,
  enqueueDuoResponseSchema,
  getCurrentDuoResponseSchema,
} from '@receipts/core';
import type { z } from 'zod';
import { request, type ApiResult } from './pick-client';

type EnqueueDuoResponse = z.infer<typeof enqueueDuoResponseSchema>;
type DequeueDuoResponse = z.infer<typeof dequeueDuoResponseSchema>;
type GetCurrentDuoResponse = z.infer<typeof getCurrentDuoResponseSchema>;
type DisbandDuoResponse = z.infer<typeof disbandDuoResponseSchema>;

/** `POST /api/v1/duo/queue` (§9.2, claimed). Body is `{}` (§9.2 `enqueueDuoRequestSchema`) —
 * eligibility is re-checked server-side; a caller who's already queued gets back
 * `ELIGIBILITY_NOT_MET` with `details.reason === 'already_queued'` (`duo-queue.ts`'s
 * `eligibilityError`), which `DuoHubClient` treats as confirmation rather than a failure —
 * see that component's header for why (no dedicated "am I queued" endpoint exists, §9.2). */
export function joinDuoQueue(): Promise<ApiResult<EnqueueDuoResponse>> {
  return request(
    '/api/v1/duo/queue',
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
    enqueueDuoResponseSchema,
  );
}

/** `DELETE /api/v1/duo/queue` (§9.2, claimed). 404s (`NOT_FOUND`) when the caller has no
 * waiting entry — `DuoHubClient` treats that the same as a successful leave. */
export function leaveDuoQueue(): Promise<ApiResult<DequeueDuoResponse>> {
  return request('/api/v1/duo/queue', { method: 'DELETE' }, dequeueDuoResponseSchema);
}

/** `GET /api/v1/duo/current` (§9.2, claimed): the caller's active duo (if any) + its live
 * match. `duo: null` covers both "never queued" and "queued but not yet matched" — see
 * `joinDuoQueue`'s comment for how the hub tells those apart. */
export function fetchCurrentDuo(): Promise<ApiResult<GetCurrentDuoResponse>> {
  return request('/api/v1/duo/current', { method: 'GET' }, getCurrentDuoResponseSchema);
}

/** `POST /api/v1/duos/:id/disband` (§8.5, §9.2, claimed, member-only). Unilateral — no
 * partner accept/decline step (`duo-disband.ts`'s header); the confirmation this function's
 * caller renders is entirely local UI, not a server-side consent flow. */
export function disbandDuo(duoId: string): Promise<ApiResult<DisbandDuoResponse>> {
  return request(
    `/api/v1/duos/${encodeURIComponent(duoId)}/disband`,
    { method: 'POST' },
    disbandDuoResponseSchema,
  );
}
