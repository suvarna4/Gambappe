/**
 * `POST /api/v1/duos/:id/disband` (design doc §8.5, §9.2, WS6-T4). Claimed + member-only;
 * unilateral (no partner accept/decline step — see `@/lib/duo-disband`'s header for why "consent
 * flow" here means "no consent required, just a notification"). Behind the `duo_queue` flag
 * (§4.6) like every other duo surface. Business logic lives in `@/lib/duo-disband`'s
 * `disbandDuoForMember` so the route stays thin (§4.3).
 */
import type { NextResponse } from 'next/server';
import { ApiError, disbandDuoRequestSchema, isFlagEnabled, now } from '@receipts/core';
import type { ProfileRow } from '@receipts/db';
import { jsonSuccess, runRoute } from '@/lib/api-response';
import { assertSameOrigin } from '@/lib/origin-check';
import { resolveIdentityFromRequest } from '@/lib/identity-request';
import { getDb } from '@/lib/stores';
import { disbandDuoForMember } from '@/lib/duo-disband';

export const runtime = 'nodejs';

async function requireClaimed(request: Request): Promise<ProfileRow> {
  const { identity } = await resolveIdentityFromRequest(request);
  if (identity.kind !== 'claimed') {
    throw new ApiError('UNAUTHENTICATED', 'a claimed profile is required');
  }
  return identity.profile;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  return runRoute(async () => {
    assertSameOrigin(request);
    if (!isFlagEnabled('duo_queue')) {
      throw new ApiError('NOT_FOUND', 'duo pages are not available');
    }

    const { id } = disbandDuoRequestSchema.shape.params.parse(await params);
    const profile = await requireClaimed(request);

    const result = await disbandDuoForMember(getDb(), id, profile.id, now());
    return jsonSuccess(result);
  });
}
