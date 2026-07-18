/**
 * `POST|DELETE /api/v1/push/subscribe` (design doc §13.2, §9.2, WS9-T2). Auth: claimed only —
 * push is opted into post-claim on an explicit tap (never for ghosts), and delivery is
 * addressed by `profile_id` (`notify:dispatch`'s push pass, WS9-T2). Flagged (`web_push`):
 * 404s like the endpoint doesn't exist while the flag is off, matching the wallet-linking
 * routes' posture for a V1-only surface.
 */
import type { NextResponse } from 'next/server';
import {
  ApiError,
  isFlagEnabled,
  now,
  pushSubscriptionBodySchema,
  pushUnsubscribeRequestSchema,
} from '@receipts/core';
import { jsonSuccess, runRoute } from '@/lib/api-response';
import { assertSameOrigin } from '@/lib/origin-check';
import { resolveIdentityFromRequest } from '@/lib/identity-request';
import { subscribePush, unsubscribePush } from '@/lib/push/subscribe-flow';
import { getDb } from '@/lib/stores';

export const runtime = 'nodejs';

const unsubscribeBodySchema = pushUnsubscribeRequestSchema.shape.body;

export async function POST(request: Request): Promise<NextResponse> {
  return runRoute(async () => {
    assertSameOrigin(request);
    if (!isFlagEnabled('web_push')) throw new ApiError('NOT_FOUND', 'not found');

    const { identity } = await resolveIdentityFromRequest(request);
    if (identity.kind !== 'claimed') throw new ApiError('UNAUTHENTICATED', 'a claimed profile is required');

    const body = pushSubscriptionBodySchema.parse(await request.json());
    const result = await subscribePush(getDb(), identity.profile.id, body);

    return jsonSuccess(result, { status: 201 });
  });
}

export async function DELETE(request: Request): Promise<NextResponse> {
  return runRoute(async () => {
    assertSameOrigin(request);
    if (!isFlagEnabled('web_push')) throw new ApiError('NOT_FOUND', 'not found');

    const { identity } = await resolveIdentityFromRequest(request);
    if (identity.kind !== 'claimed') throw new ApiError('UNAUTHENTICATED', 'a claimed profile is required');

    const body = unsubscribeBodySchema.parse(await request.json());
    const result = await unsubscribePush(getDb(), identity.profile.id, body.endpoint, now());

    return jsonSuccess(result);
  });
}
