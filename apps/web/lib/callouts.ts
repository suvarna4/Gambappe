/**
 * Call-out (challenge-link) business logic (journeys plan §4/§5 WS20-T3, D-J5). This is the
 * server end-to-end for the challenge/referral loop: a claimed challenger mints a link (random
 * 32-byte token, only its SHA-256 stored, 24h expiry), a link opener previews it (spectator-safe
 * fields), a claimed opponent accepts it (→ next-week nemesis pairing via `acceptCallout`) or
 * declines it.
 *
 * Route handlers are thin parse → authorize → delegate layers over the functions here (mirroring
 * `lib/nemesis/rematch.ts`); route auth (Auth.js session resolution) isn't mockable in vitest, so
 * these functions are the integration-tested seam — see `test/integration/callouts-api.test.ts`.
 *
 * The token contract: `createCalloutForChallenger` is the ONLY place the raw token is ever
 * emitted (in `share_url`); every lookup path hashes the incoming raw token and matches on the
 * stored hash. The raw token is never persisted.
 */
import { createHash, randomBytes } from 'node:crypto';
import {
  ApiError,
  acceptCalloutResponseSchema,
  addDaysToDateString,
  calloutCreateResponseSchema,
  calloutPreviewSchema,
  calloutSchema,
  declineCalloutResponseSchema,
  etDateString,
  isoWeekMonday,
  now,
} from '@receipts/core';
import type { CalloutPreview, CalloutCreateResponse } from '@receipts/core';
import {
  acceptCallout,
  createCallout,
  declineCallout,
  getCalloutByTokenHash,
  getOrCreateNemesisSeasonCovering,
  getProfileById,
  type CalloutRow,
  type Db,
  type ProfileRow,
} from '@receipts/db';
import { appUrl } from './app-url';

/** Challenge-link token entropy — 32 random bytes (journeys plan §5 WS20-T3). */
const CALLOUT_TOKEN_BYTES = 32;
/** Link lifetime — 24h from creation (journeys plan §5 WS20-T3). */
const CALLOUT_TTL_MS = 24 * 60 * 60 * 1000;

/** SHA-256(rawToken) hex — the exact hash `callouts.token_hash` stores. */
export function hashCalloutToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

function profileRef(p: ProfileRow) {
  return { profile_id: p.id, handle: p.handle, slug: p.slug };
}

/**
 * `CalloutRow` → the `calloutSchema` wire shape, resolving `challenger`/`opponent` refs from the
 * row's own ids (opponent is null until accepted; decline never sets it). Throws if the
 * challenger profile is missing — profiles are never hard-deleted (§11.4), so that's a corrupt
 * row, not a reachable state.
 */
async function serializeCallout(db: Db, row: CalloutRow) {
  const challenger = await getProfileById(db, row.challengerProfileId);
  if (!challenger) throw new ApiError('INTERNAL', 'call-out challenger profile missing');
  const opponent = row.opponentProfileId ? await getProfileById(db, row.opponentProfileId) : null;
  return calloutSchema.parse({
    id: row.id,
    status: row.status,
    challenger: profileRef(challenger),
    opponent: opponent ? profileRef(opponent) : null,
    expires_at: row.expiresAt.toISOString(),
    created_at: row.createdAt.toISOString(),
    pairing_id: row.pairingId ?? null,
  });
}

/**
 * `POST /api/v1/callouts` (claimed). Mints a fresh challenge link. `target_profile_id` from the
 * body is accepted but not persisted — the `callouts` table has no target column (the accept flow
 * is open by design: whoever opens and accepts the link becomes the opponent), so a target only
 * ever informs the caller's own share copy. See the WS20-T3 report for that decision.
 */
export async function createCalloutForChallenger(
  db: Db,
  challenger: ProfileRow,
  at: Date = now(),
): Promise<CalloutCreateResponse> {
  const rawToken = randomBytes(CALLOUT_TOKEN_BYTES).toString('base64url');
  const tokenHash = hashCalloutToken(rawToken);
  const expiresAt = new Date(at.getTime() + CALLOUT_TTL_MS);

  const row = await createCallout(db, { challengerProfileId: challenger.id, tokenHash, expiresAt });

  return calloutCreateResponseSchema.parse({
    callout: await serializeCallout(db, row),
    // The one and only place the raw token leaves the server (journeys plan §5 WS20-T3).
    share_url: `${appUrl()}/rivals?callout=${rawToken}`,
  });
}

export type CalloutPreviewResult =
  | { ok: true; preview: CalloutPreview }
  | { ok: false; reason: 'not_found' | 'expired' };

/**
 * `GET /api/v1/callouts/:token` (public). Spectator-safe preview: challenger ref, status, expiry
 * — never the opponent or any internal id. A GET performs no writes, so an expired-by-time
 * callout is reported as `expired` (→ 410) WITHOUT being persisted as `expired` (that lazy write
 * happens on the next accept/decline). Missing token → `not_found` (→ 404).
 */
export async function getCalloutPreview(
  db: Db,
  rawToken: string,
  at: Date = now(),
): Promise<CalloutPreviewResult> {
  const row = await getCalloutByTokenHash(db, hashCalloutToken(rawToken));
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.status === 'expired' || (row.status === 'pending' && row.expiresAt.getTime() <= at.getTime())) {
    return { ok: false, reason: 'expired' };
  }

  const challenger = await getProfileById(db, row.challengerProfileId);
  if (!challenger) return { ok: false, reason: 'not_found' };

  return {
    ok: true,
    preview: calloutPreviewSchema.parse({
      status: row.status,
      challenger: profileRef(challenger),
      expires_at: row.expiresAt.toISOString(),
    }),
  };
}

export type CalloutResolveReason = 'not_found' | 'expired' | 'already_resolved' | 'self_challenge';

export type CalloutAcceptResult =
  | { ok: true; response: ReturnType<typeof acceptCalloutResponseSchema.parse> }
  | { ok: false; reason: CalloutResolveReason };

/**
 * `POST /api/v1/callouts/:token/accept` (claimed). Resolves the next-week Monday and its nemesis
 * season (auto-created if none covers it — the same get-or-create `nemesis:assign` uses), then
 * delegates to the transactional, idempotent `acceptCallout` repo, which mints the canonical
 * `a<b` next-week pairing. The repo's `already_resolved`/`self_challenge`/`expired`/`not_found`
 * reasons flow straight through for the route to map onto 409/409/410/404.
 */
export async function acceptCalloutForOpponent(
  db: Db,
  rawToken: string,
  opponent: ProfileRow,
  at: Date = now(),
): Promise<CalloutAcceptResult> {
  const tokenHash = hashCalloutToken(rawToken);

  // The next-week Monday the created pairing runs in (journeys plan §5 WS20-T3).
  const weekStart = addDaysToDateString(isoWeekMonday(etDateString(at)), 7);
  const { season } = await getOrCreateNemesisSeasonCovering(db, weekStart);

  const res = await acceptCallout(db, {
    tokenHash,
    opponentProfileId: opponent.id,
    seasonId: season.id,
    weekStart,
  });
  if (!res.ok) return { ok: false, reason: res.reason };

  return {
    ok: true,
    response: acceptCalloutResponseSchema.parse({ callout: await serializeCallout(db, res.callout) }),
  };
}

export type CalloutDeclineResult =
  | { ok: true; response: ReturnType<typeof declineCalloutResponseSchema.parse> }
  | { ok: false; reason: 'not_found' | 'expired' | 'already_resolved' };

/**
 * `POST /api/v1/callouts/:token/decline` (claimed). Flips a `pending` callout to `declined` via
 * the transactional/idempotent `declineCallout` repo. Possessing the token is the authorization
 * (the link model — whoever holds the link may accept or decline it); decline never creates a
 * pairing and never records an opponent.
 */
export async function declineCalloutForActor(db: Db, rawToken: string): Promise<CalloutDeclineResult> {
  const res = await declineCallout(db, { tokenHash: hashCalloutToken(rawToken) });
  if (!res.ok) return { ok: false, reason: res.reason };
  return {
    ok: true,
    response: declineCalloutResponseSchema.parse({ callout: await serializeCallout(db, res.callout) }),
  };
}
