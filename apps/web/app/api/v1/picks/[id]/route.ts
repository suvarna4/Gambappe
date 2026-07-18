/**
 * `DELETE /api/v1/picks/:id` — §6.2 undo. Ownership + window/lock checks; the window/lock
 * check is evaluated IN POSTGRES on the delete statement itself (clock-authority rule, same as
 * placement) via `undoPickTx`. Hard delete + counter decrement in one transaction.
 */
import type { NextResponse } from 'next/server';
import { ApiError, UNDO_WINDOW_S, zPickId } from '@receipts/core';
import { undoPickTx } from '@receipts/db';
import { jsonSuccess, runRoute } from '@/lib/api-response';
import { assertSameOrigin } from '@/lib/origin-check';
import { resolveIdentityFromRequest } from '@/lib/identity-request';
import { enforceRateLimit } from '@/lib/rate-limit';
import { getDb } from '@/lib/stores';

export const runtime = 'nodejs';

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  return runRoute(async () => {
    assertSameOrigin(request);

    const { identity } = await resolveIdentityFromRequest(request);
    if (identity.kind === 'anonymous') {
      throw new ApiError('UNAUTHENTICATED', 'a ghost or claimed profile is required');
    }

    // §14.1: undo 10/h/profile.
    const rateLimited = await enforceRateLimit('undo', identity.profile.id);
    if (rateLimited) return rateLimited;

    const { id: rawId } = await params;
    const pickIdParse = zPickId.safeParse(rawId);
    if (!pickIdParse.success) throw new ApiError('VALIDATION_FAILED', 'invalid pick id');

    const result = await undoPickTx(getDb(), pickIdParse.data, identity.profile.id, UNDO_WINDOW_S);
    switch (result.outcome) {
      case 'not_found':
        throw new ApiError('NOT_FOUND', 'no such pick');
      case 'forbidden':
        throw new ApiError('FORBIDDEN', 'this pick belongs to another profile');
      case 'expired':
        throw new ApiError('UNDO_EXPIRED', 'the undo window has passed');
      case 'deleted':
        return jsonSuccess({ deleted: true as const });
    }
  });
}
