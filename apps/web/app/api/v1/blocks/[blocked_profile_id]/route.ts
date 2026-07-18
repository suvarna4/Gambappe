/**
 * `DELETE /api/v1/blocks/:blocked_profile_id` (design doc §9.2, §14.3, WS11-T3). Auth: claimed
 * only. Unblocking only removes the block row — it never reverses whatever the mid-week exit
 * rule already did to a pairing at block time (§5.7's early-conclusion/cancellation is a
 * one-time consequence, not a reversible pause).
 */
import type { NextResponse } from 'next/server';
import { ApiError, deleteBlockRequestSchema } from '@receipts/core';
import { jsonSuccess, runRoute } from '@/lib/api-response';
import { assertSameOrigin } from '@/lib/origin-check';
import { resolveIdentityFromRequest } from '@/lib/identity-request';
import { deleteBlock } from '@receipts/db';
import { getDb } from '@/lib/stores';

export const runtime = 'nodejs';

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ blocked_profile_id: string }> },
): Promise<NextResponse> {
  return runRoute(async () => {
    assertSameOrigin(request);

    const { identity } = await resolveIdentityFromRequest(request);
    if (identity.kind !== 'claimed') {
      throw new ApiError('UNAUTHENTICATED', 'a claimed profile is required');
    }

    const { blocked_profile_id } = deleteBlockRequestSchema.shape.params.parse(await params);

    await deleteBlock(getDb(), identity.profile.id, blocked_profile_id);

    return jsonSuccess({ unblocked: true as const });
  });
}
