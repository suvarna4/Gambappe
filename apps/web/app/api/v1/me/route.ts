/**
 * `DELETE /api/v1/me` (design doc §11.4, §9.2, WS2-T5). Body `{confirm: handle}` — rejected
 * unless it exactly matches the caller's CURRENT handle (irreversible; confirm requires typing
 * the handle, mirroring the client's confirm modal).
 */
import type { NextResponse } from 'next/server';
import { ApiError, deleteMeBodySchema, now } from '@receipts/core';
import { deleteAccount } from '@receipts/db';
import { jsonSuccess, runRoute } from '@/lib/api-response';
import { assertSameOrigin } from '@/lib/origin-check';
import { resolveIdentityFromRequest } from '@/lib/identity-request';
import { GHOST_COOKIE_NAME, clearedGhostCookieOptions } from '@/lib/ghost-cookie';
import { getDb } from '@/lib/stores';

export const runtime = 'nodejs';

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

    await deleteAccount(getDb(), identity.profile.id, identity.profile.userId, now());

    const response = jsonSuccess({ deleted: true as const });
    response.cookies.set(GHOST_COOKIE_NAME, '', clearedGhostCookieOptions());
    return response;
  });
}
