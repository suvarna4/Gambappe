/**
 * `GET /api/v1/me` (design doc §9.2 "ghost+"; see `@/lib/get-me.ts` for the SPEC-GAP note on why
 * WS7-T5 is the one implementing this route) and `DELETE /api/v1/me` (design doc §11.4, §9.2,
 * WS2-T5). Body `{confirm: handle}` on DELETE — rejected unless it exactly matches the caller's
 * CURRENT handle (irreversible; confirm requires typing the handle, mirroring the client's
 * confirm modal).
 */
import type { NextResponse } from 'next/server';
import { ApiError, deleteMeBodySchema, now } from '@receipts/core';
import { jsonSuccess, runRoute } from '@/lib/api-response';
import { assertSameOrigin } from '@/lib/origin-check';
import { resolveIdentityFromRequest } from '@/lib/identity-request';
import { GHOST_COOKIE_NAME, clearedGhostCookieOptions } from '@/lib/ghost-cookie';
import { buildMeResponse } from '@/lib/get-me';
import { getDb } from '@/lib/stores';
import { deleteClaimedAccount } from '@/lib/account-deletion';

export const runtime = 'nodejs';

export async function GET(request: Request): Promise<NextResponse> {
  return runRoute(async () => {
    const { identity, clearGhostCookie } = await resolveIdentityFromRequest(request);
    const data = await buildMeResponse(getDb(), identity);
    const response = jsonSuccess(data);
    // Same posture as every other cookie-reading route (§6.1.1): an invalid/stale ghost cookie
    // is cleared, never surfaced as an error.
    if (clearGhostCookie) {
      response.cookies.set(GHOST_COOKIE_NAME, '', clearedGhostCookieOptions());
    }
    return response;
  });
}

export async function DELETE(request: Request): Promise<NextResponse> {
  return runRoute(async () => {
    assertSameOrigin(request);

    const { identity } = await resolveIdentityFromRequest(request);
    if (identity.kind !== 'claimed') {
      throw new ApiError('UNAUTHENTICATED', 'a claimed profile is required');
    }

    const body = deleteMeBodySchema.parse(await request.json());
    if (body.confirm !== identity.profile.handle) {
      throw new ApiError('VALIDATION_FAILED', 'confirm must exactly match your current handle');
    }
    if (!identity.profile.userId) {
      // Cannot happen for a 'claimed' profile, but keeps the deletion call's types honest.
      throw new ApiError('INTERNAL', 'claimed profile missing user_id');
    }

    const deletionAt = now();
    // §11.4: an active nemesis pairing and/or duo match take the §5.7 mid-week exit (deletion
    // is one of its named trigger events — same integrity rule as blocking, §14.3), then the
    // deletion transaction runs — all composed atomically by `deleteClaimedAccount` (see its
    // header for why the exits can't live inside packages/db's `deleteAccount`).
    await deleteClaimedAccount(getDb(), identity.profile.id, identity.profile.userId, deletionAt);

    const response = jsonSuccess({ deleted: true as const });
    response.cookies.set(GHOST_COOKIE_NAME, '', clearedGhostCookieOptions());
    return response;
  });
}
