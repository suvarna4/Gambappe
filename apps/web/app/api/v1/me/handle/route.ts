/**
 * `PATCH /api/v1/me/handle` (design doc §6.1.2, §9.2, WS2-T4). Custom handle change: format
 * (zod, already `.strict()`) + reserved-terms + profanity screening (WS2-T1), uniqueness, and
 * the `HANDLE_CHANGE_COOLDOWN_DAYS` (30) cooldown tracked via `profiles.handle_changed_at`.
 */
import type { NextResponse } from 'next/server';
import { ApiError, now, slugifyHandle, updateHandleBodySchema } from '@receipts/core';
import { handleExists, updateProfileById } from '@receipts/db';
import { jsonSuccess, runRoute } from '@/lib/api-response';
import { assertSameOrigin } from '@/lib/origin-check';
import { resolveIdentityFromRequest } from '@/lib/identity-request';
import { screenCustomHandle } from '@/lib/handle-screen';
import { checkHandleCooldown } from '@/lib/handle-cooldown';
import { getDb } from '@/lib/stores';

export const runtime = 'nodejs';

export async function PATCH(request: Request): Promise<NextResponse> {
  return runRoute(async () => {
    assertSameOrigin(request);

    const { identity } = await resolveIdentityFromRequest(request);
    if (identity.kind !== 'claimed') {
      throw new ApiError('UNAUTHENTICATED', 'a claimed profile is required');
    }

    const body = updateHandleBodySchema.parse(await request.json());
    const screen = screenCustomHandle(body.handle);
    if (!screen.ok) {
      throw new ApiError('VALIDATION_FAILED', `handle rejected (${screen.reason})`, { reason: screen.reason });
    }

    const at = now();
    const { profile } = identity;
    const cooldown = checkHandleCooldown(profile.handleChangedAt, at);
    if (!cooldown.allowed) {
      throw new ApiError('HANDLE_COOLDOWN', 'handle was changed too recently', {
        next_allowed_at: cooldown.nextAllowedAt!.toISOString(),
      });
    }

    const db = getDb();
    if (await handleExists(db, body.handle, profile.id)) {
      throw new ApiError('VALIDATION_FAILED', 'handle already taken', { field: 'handle' });
    }

    const updated = await updateProfileById(db, profile.id, {
      handle: body.handle,
      slug: slugifyHandle(body.handle),
      handleIsGenerated: false,
      handleChangedAt: at,
    });

    return jsonSuccess({ handle: updated.handle, slug: updated.slug });
  });
}
