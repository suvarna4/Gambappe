/**
 * `POST /api/v1/blocks` (design doc §9.2, §14.3, §5.7, WS11-T3). Auth: claimed only. Immediate,
 * permanent pairing exclusion both directions; applies the mid-week exit rule to the blocked
 * profile's active pairing, if any (`applyBlock`, `apps/web/lib/moderation.ts`).
 */
import type { NextResponse } from 'next/server';
import { now } from '@receipts/core';
import { ApiError, createBlockBodySchema } from '@receipts/core';
import { jsonSuccess, runRoute } from '@/lib/api-response';
import { assertSameOrigin } from '@/lib/origin-check';
import { resolveIdentityFromRequest } from '@/lib/identity-request';
import { applyBlock } from '@/lib/moderation';
import { getDb } from '@/lib/stores';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<NextResponse> {
  return runRoute(async () => {
    assertSameOrigin(request);

    const { identity } = await resolveIdentityFromRequest(request);
    if (identity.kind !== 'claimed') {
      throw new ApiError('UNAUTHENTICATED', 'a claimed profile is required');
    }

    const body = createBlockBodySchema.parse(await request.json());
    if (body.blocked_profile_id === identity.profile.id) {
      throw new ApiError('VALIDATION_FAILED', 'cannot block yourself');
    }

    await applyBlock(getDb(), identity.profile.id, body.blocked_profile_id, now());

    return jsonSuccess({ blocked: true as const });
  });
}
