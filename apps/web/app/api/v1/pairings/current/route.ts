/**
 * `GET /api/v1/pairings/current` (design doc §9.2, WS5-T4): the claimed viewer's active
 * nemesis pairing + scoreboard this week, or `{pairing: null}` if unpaired. Behind the
 * `nemesis` flag (§4.6: "off until WS5 E2E passes"), same posture as
 * `nemesis:assign`/`nemesis:conclude`. Business logic lives in `@/lib/nemesis/service` (§4.3).
 */
import type { NextResponse } from 'next/server';
import { ApiError, isFlagEnabled, now } from '@receipts/core';
import { jsonSuccess, runRoute } from '@/lib/api-response';
import { resolveIdentityFromRequest } from '@/lib/identity-request';
import { getDb } from '@/lib/stores';
import { getCurrentPairingForProfile } from '@/lib/nemesis/service';

export const runtime = 'nodejs';

export async function GET(request: Request): Promise<NextResponse> {
  return runRoute(async () => {
    if (!isFlagEnabled('nemesis')) {
      throw new ApiError('NOT_FOUND', 'nemesis is not available');
    }

    const { identity } = await resolveIdentityFromRequest(request);
    if (identity.kind !== 'claimed') {
      throw new ApiError('UNAUTHENTICATED', 'a claimed profile is required');
    }

    const pairing = await getCurrentPairingForProfile(getDb(), identity.profile.id, now());
    return jsonSuccess({ pairing });
  });
}
