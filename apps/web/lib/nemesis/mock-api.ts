/**
 * MOCK client for the nemesis rematch-request surface (WS7-T6 originally, "Mock-start OK vs
 * WS5-T4" per §19.2 / `docs/workstream-locks.md`; trimmed by WS5-T4 to just this part — see
 * below).
 *
 * WS5-T4 ("Matchup + history APIs", design doc §9.2/§9.3) has landed
 * (`apps/web/lib/nemesis/service.ts`, real `/api/v1/pairings/*` and
 * `/api/v1/me/nemesis-history` route handlers) — this file's former `getCurrentPairing`,
 * `getPairingById`, `getProfileRef`, and `getNemesisHistory` mocks were removed, and
 * `/vs/[pairingId]`/`/nemesis` now call the real service instead. `POST /rematch-requests*`
 * (§8.4 step 0) is WS5-T5 ("Rematch + pause/block integration") scope and has NOT landed yet,
 * so the functions below remain mocks, matched 1:1 to a `packages/core` schema so they cannot
 * silently drift from the documented contract:
 *
 *   createRematchRequest(...)  ~ POST /rematch-requests              (claimed)
 *   acceptRematchRequest(...)  ~ POST /rematch-requests/:id/accept   (claimed)
 *   declineRematchRequest(...) ~ POST /rematch-requests/:id/decline  (claimed)
 *
 * Every return value is `.parse()`d through the real response schema before leaving this
 * module, so a shape mismatch fails loudly (in tests, not silently in the UI) rather than
 * this mock quietly diverging from §9.2 as the real contract evolves.
 *
 * When WS5-T5 ships, callers of this module should swap these calls for real `fetch()`s
 * returning the same schema-shaped JSON — no component prop shapes should need to change,
 * because they're already typed against `./types.ts`'s `z.infer` aliases over the real
 * schemas, not this file's internals. Current caller: the interactive rematch UI
 * (`RematchPanel.tsx`, a client component) does NOT import this module directly — it goes
 * through `/api/mock/nemesis/rematch-requests*` (mock-only route handlers that wrap this
 * module) instead, because `@receipts/core` gained a `node:crypto`-importing module (WS9-T1's
 * `notifications.ts`) that breaks any client bundle importing this file transitively. See
 * that route's file header for the full explanation.
 *
 * SPEC-GAP(WS7-T6) — open question for whoever builds WS5-T5: §9.2 lists no `GET` endpoint
 * for a profile's own outgoing/incoming rematch requests, so a real client has no documented
 * way to *discover* an incoming request to accept/decline (only `POST .../accept|decline`
 * by id, which presumes the id is already known). The likely real mechanism is that
 * `POST /rematch-requests` fires a notification (§5.6 `notifications` outbox) carrying the
 * request id, and the target acts on it from that notification. This mock instead exposes
 * `getIncomingRematchRequest()` as a UI-only convenience — it is NOT part of the §9.2
 * contract and must not be treated as a preview of a real endpoint.
 */
import { ApiError, now } from '@receipts/core';
import { createRematchResponseSchema, respondRematchResponseSchema, rematchRequestSchema } from '@receipts/core';
import { CURRENT_SEASON_ID, NEMESIS_HISTORY, VIEWER, findProfile } from './mock-fixtures';
import type { RematchRequest } from './types';

// --- Rematch requests (§9.2, §8.4 step 0) -------------------------------------------------------

let rematchRequestSeq = 0;
const rematchRequests = new Map<string, RematchRequest>();

function rematchRequestId(): string {
  rematchRequestSeq += 1;
  return `00000000-0000-4000-8000-0000000009${String(rematchRequestSeq).padStart(2, '0')}`;
}

/** Seed one incoming request (Otter → viewer) so the accept/decline UI has something to show. */
function seedIncomingRequest(): void {
  const otter = findProfile('00000000-0000-4000-8000-000000000004'); // PAST_NEMESIS_LOSS
  if (!otter) return;
  const id = rematchRequestId();
  rematchRequests.set(
    id,
    rematchRequestSchema.parse({
      id,
      requester_profile_id: otter.profile_id,
      target_profile_id: VIEWER.profile_id,
      season_id: CURRENT_SEASON_ID,
      status: 'open',
      created_at: now().toISOString(),
    }),
  );
}
seedIncomingRequest();

/** Was `targetProfileId` a past nemesis of `requesterProfileId` this season (§9.2 rule)? */
function wasPastNemesisThisSeason(requesterProfileId: string, targetProfileId: string): boolean {
  if (requesterProfileId !== VIEWER.profile_id) return false; // this mock only models the viewer's own history
  return NEMESIS_HISTORY.some(
    (entry) =>
      entry.season_id === CURRENT_SEASON_ID && entry.opponent.profile_id === targetProfileId,
  );
}

/** `POST /rematch-requests` (claimed). Body `{target_profile_id}` — requester's implicit consent. */
export function createRematchRequest(requesterProfileId: string, targetProfileId: string) {
  if (requesterProfileId === targetProfileId) {
    throw new ApiError('VALIDATION_FAILED', 'cannot request a rematch against yourself');
  }
  if (!wasPastNemesisThisSeason(requesterProfileId, targetProfileId)) {
    throw new ApiError('VALIDATION_FAILED', 'target must be a past nemesis this season');
  }
  const alreadyOpen = [...rematchRequests.values()].find(
    (r) =>
      r.status === 'open' &&
      r.requester_profile_id === requesterProfileId &&
      r.target_profile_id === targetProfileId,
  );
  if (alreadyOpen) {
    return createRematchResponseSchema.parse({ request: alreadyOpen });
  }
  const id = rematchRequestId();
  const request = rematchRequestSchema.parse({
    id,
    requester_profile_id: requesterProfileId,
    target_profile_id: targetProfileId,
    season_id: CURRENT_SEASON_ID,
    status: 'open',
    created_at: now().toISOString(),
  });
  rematchRequests.set(id, request);
  return createRematchResponseSchema.parse({ request });
}

function respond(requestId: string, actingProfileId: string, newStatus: 'accepted' | 'declined') {
  const request = rematchRequests.get(requestId);
  if (!request) throw new ApiError('NOT_FOUND', 'rematch request not found');
  if (request.target_profile_id !== actingProfileId) {
    // Only the target consents via accept/decline — the requester already consented by
    // creating the request (§8.4 step 0: "mutually-accepted ... a request needs BOTH sides
    // to accept" — the requester's half of that mutual consent is baked into the create
    // call itself, so only the target-side action remains).
    throw new ApiError('FORBIDDEN', 'only the request target may accept or decline');
  }
  if (request.status !== 'open') {
    throw new ApiError('VALIDATION_FAILED', `request is already ${request.status}`);
  }
  const updated: RematchRequest = { ...request, status: newStatus };
  rematchRequests.set(requestId, updated);
  return respondRematchResponseSchema.parse({ request: updated });
}

/**
 * `POST /rematch-requests/:id/accept` (claimed). Mutual acceptance doesn't create a pairing
 * synchronously — per §8.4 step 0, the next `nemesis:assign` run (Monday 09:00 ET) is what
 * turns a mutually-accepted request into an actual `nemesis_pairings` row, marked
 * `is_rematch`. This mock does not simulate that batch job (it's WS5 scope); the UI copy for
 * an accepted request says "you'll be paired starting next week," not "paired now."
 */
export function acceptRematchRequest(requestId: string, actingProfileId: string) {
  return respond(requestId, actingProfileId, 'accepted');
}

/** `POST /rematch-requests/:id/decline` (claimed). */
export function declineRematchRequest(requestId: string, actingProfileId: string) {
  return respond(requestId, actingProfileId, 'declined');
}

/**
 * NOT part of the §9.2 contract (see file header SPEC-GAP) — a mock-only convenience so the
 * UI can show "X wants a rematch" without a real discovery endpoint to call.
 */
export function getIncomingRematchRequest(targetProfileId: string): RematchRequest | null {
  return (
    [...rematchRequests.values()].find(
      (r) => r.target_profile_id === targetProfileId && r.status === 'open',
    ) ?? null
  );
}

/** Mock-only: the caller's own most recent outgoing request to a given target, if any. */
export function getOutgoingRematchRequest(
  requesterProfileId: string,
  targetProfileId: string,
): RematchRequest | null {
  return (
    [...rematchRequests.values()]
      .filter(
        (r) =>
          r.requester_profile_id === requesterProfileId && r.target_profile_id === targetProfileId,
      )
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null
  );
}

/** Test-only: resets in-memory rematch-request state between tests. */
export function __resetRematchRequestsForTests(): void {
  rematchRequests.clear();
  rematchRequestSeq = 0;
  seedIncomingRequest();
}
