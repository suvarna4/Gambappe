/**
 * `POST /api/v1/callouts` (journeys plan §5 WS20-T3, D-J5). Claimed-only. Mints a challenge link:
 * a random 32-byte token whose SHA-256 is stored (`createCallout`), 24h expiry, and responds with
 * `calloutCreateResponseSchema` — the callout plus `share_url = {APP_URL}/rivals?callout={token}`
 * (the raw token rides the URL only, never persisted). Flag-gated on `callouts` (404 when off),
 * origin-checked, and rate-limited (`callout_create`). Business logic lives in `@/lib/callouts`.
 */
import type { NextResponse } from 'next/server';
import { ApiError, createCalloutBodySchema, isFlagEnabled, now } from '@receipts/core';
import { jsonSuccess, runRoute } from '@/lib/api-response';
import { assertSameOrigin } from '@/lib/origin-check';
import { resolveIdentityFromRequest } from '@/lib/identity-request';
import { enforceRateLimit } from '@/lib/rate-limit';
import { createCalloutForChallenger } from '@/lib/callouts';
import { getDb } from '@/lib/stores';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<NextResponse> {
  return runRoute(async () => {
    assertSameOrigin(request);
    if (!isFlagEnabled('callouts')) {
      throw new ApiError('NOT_FOUND', 'call-outs are not available');
    }

    const { identity } = await resolveIdentityFromRequest(request);
    if (identity.kind !== 'claimed') {
      throw new ApiError('UNAUTHENTICATED', 'a claimed profile is required');
    }

    const limited = await enforceRateLimit('callout_create', identity.profile.id);
    if (limited) return limited;

    // Body is optional (`target_profile_id?`); tolerate an empty/absent body.
    const raw = await request.json().catch(() => ({}));
    createCalloutBodySchema.parse(raw);

    const result = await createCalloutForChallenger(getDb(), identity.profile, now());
    return jsonSuccess(result, { status: 201 });
  });
}
