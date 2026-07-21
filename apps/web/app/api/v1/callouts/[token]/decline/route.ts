/**
 * `POST /api/v1/callouts/:token/decline` (journeys plan §5 WS20-T3, D-J5). Claimed-only. Flips a
 * `pending` call-out to `declined` via the transactional/idempotent `declineCallout` repo (no
 * pairing is created). Result mapping mirrors accept: `already_resolved` → 409, `expired` → 410,
 * `not_found` → 404, ok → `declineCalloutResponseSchema`. Flag-gated on `callouts` (404 when off),
 * origin-checked, rate-limited (`callout_respond`).
 */
import type { NextResponse } from 'next/server';
import { ApiError, calloutTokenParamsSchema, isFlagEnabled } from '@receipts/core';
import { jsonSuccess, runRoute } from '@/lib/api-response';
import { assertSameOrigin } from '@/lib/origin-check';
import { resolveIdentityFromRequest } from '@/lib/identity-request';
import { enforceRateLimit } from '@/lib/rate-limit';
import { calloutErrorResponse } from '@/lib/callout-response';
import { declineCalloutForActor } from '@/lib/callouts';
import { getDb } from '@/lib/stores';

export const runtime = 'nodejs';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  return runRoute(async () => {
    assertSameOrigin(request);
    if (!isFlagEnabled('callouts')) {
      throw new ApiError('NOT_FOUND', 'call-outs are not available');
    }

    const { identity } = await resolveIdentityFromRequest(request);
    if (identity.kind !== 'claimed') {
      throw new ApiError('UNAUTHENTICATED', 'a claimed profile is required');
    }

    const limited = await enforceRateLimit('callout_respond', identity.profile.id);
    if (limited) return limited;

    const { token } = calloutTokenParamsSchema.parse(await params);

    const result = await declineCalloutForActor(getDb(), token);
    if (!result.ok) return calloutErrorResponse(result.reason);
    return jsonSuccess(result.response);
  });
}
