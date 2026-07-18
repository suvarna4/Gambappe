/**
 * `POST /api/v1/duo/queue` · `DELETE /api/v1/duo/queue` (design doc §8.5, §9.2, WS6-T1).
 * Both claimed-only (§9.2 auth column). Behind the `duo_queue` flag (§4.6; §19.5 "Gate P1.5:
 * duo behind flag until one internal ladder window completes cleanly") — 404s while disabled,
 * per §19.4 rule 2 ("anything user-visible behind the correct flag until its workstream's E2E
 * passes"). The actual eligibility/join/leave logic lives in `@/lib/duo-queue` so it's testable
 * without a Next.js request/response harness (mirrors the WS2-T3 `runClaim` pattern).
 */
import type { NextResponse } from 'next/server';
import { ApiError, isFlagEnabled } from '@receipts/core';
import type { ProfileRow } from '@receipts/db';
import { jsonSuccess, runRoute } from '@/lib/api-response';
import { assertSameOrigin } from '@/lib/origin-check';
import { resolveIdentityFromRequest } from '@/lib/identity-request';
import { getDb } from '@/lib/stores';
import { joinDuoQueue, leaveDuoQueue } from '@/lib/duo-queue';

export const runtime = 'nodejs';

function assertDuoQueueEnabled(): void {
  if (!isFlagEnabled('duo_queue')) {
    throw new ApiError('NOT_FOUND', 'duo queue is not available');
  }
}

async function requireClaimed(request: Request): Promise<ProfileRow> {
  const { identity } = await resolveIdentityFromRequest(request);
  if (identity.kind !== 'claimed') {
    throw new ApiError('UNAUTHENTICATED', 'a claimed profile is required');
  }
  return identity.profile;
}

export async function POST(request: Request): Promise<NextResponse> {
  return runRoute(async () => {
    assertSameOrigin(request);
    assertDuoQueueEnabled();
    const profile = await requireClaimed(request);

    const entry = await joinDuoQueue(getDb(), profile);
    return jsonSuccess(
      { entry: { id: entry.id, status: entry.status, enqueued_at: entry.enqueuedAt.toISOString() } },
      { status: 201 },
    );
  });
}

export async function DELETE(request: Request): Promise<NextResponse> {
  return runRoute(async () => {
    assertSameOrigin(request);
    assertDuoQueueEnabled();
    const profile = await requireClaimed(request);

    const left = await leaveDuoQueue(getDb(), profile.id);
    if (!left) {
      throw new ApiError('NOT_FOUND', 'you are not currently in the duo queue');
    }
    return jsonSuccess({ left: true as const });
  });
}
