/**
 * `GET /api/v1/me` (design doc §9.2 "ghost+"; see `@/lib/get-me.ts` for the SPEC-GAP note on why
 * WS7-T5 is the one implementing this route) and `DELETE /api/v1/me` (design doc §11.4, §9.2,
 * WS2-T5). Body `{confirm: handle}` on DELETE — rejected unless it exactly matches the caller's
 * CURRENT handle (irreversible; confirm requires typing the handle, mirroring the client's
 * confirm modal).
 */
import type { NextResponse } from 'next/server';
import { ApiError, deleteMeBodySchema, now } from '@receipts/core';
import { deleteAccount } from '@receipts/db';
import { jsonSuccess, runRoute } from '@/lib/api-response';
import { assertSameOrigin } from '@/lib/origin-check';
import { resolveIdentityFromRequest } from '@/lib/identity-request';
import { GHOST_COOKIE_NAME, clearedGhostCookieOptions } from '@/lib/ghost-cookie';
import { buildMeResponse } from '@/lib/get-me';
import { enforceGetBackstop } from '@/lib/rate-limit';
import { getDb } from '@/lib/stores';
import { applyDuoMidWindowExit } from '@/lib/duo-match-lifecycle';

export const runtime = 'nodejs';

export async function GET(request: Request): Promise<NextResponse> {
  return runRoute(async () => {
    const limited = await enforceGetBackstop(request);
    if (limited) return limited;

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
    // §5.7 mid-window exit (WS6-T2): deletion is one of the trigger events for an active duo
    // match, same integrity rule as nemesis (§14.3). Run BEFORE `deleteAccount` — `deleteAccount`
    // itself can't do this (packages/db has no @receipts/engine dependency for the scoring/
    // rating math, §4.2 — see `deleteAccount`'s own SPEC-GAP(WS2-T5) comment, written before
    // WS6 existed, anticipating exactly this caller-side follow-up). Deliberately its own
    // transaction, separate from `deleteAccount`'s — the duo match doesn't reference anything
    // `deleteAccount` mutates (handle/slug rewrite, etc.), so there's no atomicity requirement
    // tying the two together.
    await applyDuoMidWindowExit(getDb(), identity.profile.id, deletionAt);

    await deleteAccount(getDb(), identity.profile.id, identity.profile.userId, deletionAt);

    const response = jsonSuccess({ deleted: true as const });
    response.cookies.set(GHOST_COOKIE_NAME, '', clearedGhostCookieOptions());
    return response;
  });
}
