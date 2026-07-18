/**
 * `DELETE /api/v1/wallet` (design doc §12.5, WS12-T3). Auth: claimed. Thin adapter over
 * `wallet-flow.ts`'s `unlinkWallet` — see that file (and its SPEC-GAP note on the
 * `placement_prior` recompute) for the actual logic.
 */
import type { NextResponse } from 'next/server';
import { ApiError, isFlagEnabled, now } from '@receipts/core';
import { jsonSuccess, runRoute } from '@/lib/api-response';
import { assertSameOrigin } from '@/lib/origin-check';
import { resolveIdentityFromRequest } from '@/lib/identity-request';
import { unlinkWallet } from '@/lib/wallet-flow';
import { getDb } from '@/lib/stores';

export const runtime = 'nodejs';

export async function DELETE(request: Request): Promise<NextResponse> {
  return runRoute(async () => {
    assertSameOrigin(request);
    if (!isFlagEnabled('wallet_linking')) throw new ApiError('NOT_FOUND', 'not found');

    const { identity } = await resolveIdentityFromRequest(request);
    if (identity.kind !== 'claimed') throw new ApiError('UNAUTHENTICATED', 'a claimed profile is required');

    const result = await unlinkWallet(identity.profile.id, { db: getDb(), at: now() });
    return jsonSuccess(result);
  });
}
