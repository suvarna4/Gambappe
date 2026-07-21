/**
 * `POST /api/v1/callouts/:token/accept` (journeys plan §5 WS20-T3, D-J5). Claimed-only. Resolves
 * the next-week Monday + its nemesis season (auto-created, mirroring `nemesis:assign` via the
 * shared `getOrCreateNemesisSeasonCovering`), then calls the transactional/idempotent
 * `acceptCallout`, minting the next-week pairing. Result mapping: `already_resolved`/
 * `self_challenge` → 409, `expired` → 410, `not_found` → 404, ok → `acceptCalloutResponseSchema`.
 * A **ghost/anonymous** visitor gets 401 `{reason: 'save_required'}` (D-J8 Save flow). Flag-gated
 * on `callouts` (404 when off), origin-checked, rate-limited (`callout_respond`).
 */
import type { NextResponse } from 'next/server';
import { ApiError, calloutTokenParamsSchema, isFlagEnabled, now } from '@receipts/core';
import { jsonSuccess, runRoute } from '@/lib/api-response';
import { assertSameOrigin } from '@/lib/origin-check';
import { resolveIdentityFromRequest } from '@/lib/identity-request';
import { enforceRateLimit } from '@/lib/rate-limit';
import { calloutErrorResponse, calloutSaveRequiredResponse } from '@/lib/callout-response';
import { acceptCalloutForOpponent } from '@/lib/callouts';
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
      // Ghost/anonymous → the Save flow (WS20-T3 AC): 401 with the `save_required` discriminator.
      return calloutSaveRequiredResponse();
    }

    const limited = await enforceRateLimit('callout_respond', identity.profile.id);
    if (limited) return limited;

    const { token } = calloutTokenParamsSchema.parse(await params);

    const result = await acceptCalloutForOpponent(getDb(), token, identity.profile, now());
    if (!result.ok) return calloutErrorResponse(result.reason);
    return jsonSuccess(result.response);
  });
}
