/**
 * `GET /api/v1/duo/current` (design doc §9.2, WS6-T1): my active duo + its current match.
 * Claimed only (§9.2 auth column). Behind the `duo_queue` flag (§4.6, §19.5) like the queue
 * endpoints — see `../queue/route.ts` for the rationale.
 */
import type { NextResponse } from 'next/server';
import { ApiError, isFlagEnabled, now } from '@receipts/core';
import { jsonSuccess, runRoute } from '@/lib/api-response';
import { resolveIdentityFromRequest } from '@/lib/identity-request';
import { enforceGetBackstop } from '@/lib/rate-limit';
import { getDb } from '@/lib/stores';
import { computePartnerPickToday, getCurrentDuoAndMatch } from '@/lib/duo-queue';
import { toDuoMatchPublic, toDuoPublic } from '@/lib/serialize-duo';

export const runtime = 'nodejs';

export async function GET(request: Request): Promise<NextResponse> {
  return runRoute(async () => {
    const limited = await enforceGetBackstop(request);
    if (limited) return limited;

    if (!isFlagEnabled('duo_queue')) {
      throw new ApiError('NOT_FOUND', 'duo queue is not available');
    }

    const { identity } = await resolveIdentityFromRequest(request);
    if (identity.kind !== 'claimed') {
      throw new ApiError('UNAUTHENTICATED', 'a claimed profile is required');
    }

    const db = getDb();
    const { duo, match } = await getCurrentDuoAndMatch(db, identity.profile.id);
    // SW10-T3(a) (wiring-gaps doc §4): side-free, so it's safe to compute unconditionally for
    // any active duo — never gated on `match` (a duo can be active between match windows too).
    const partnerPickToday = duo
      ? await computePartnerPickToday(db, duo, identity.profile.id, now())
      : null;
    return jsonSuccess({
      duo: duo ? await toDuoPublic(db, duo) : null,
      match: match ? toDuoMatchPublic(match) : null,
      partner_pick_today: partnerPickToday,
    });
  });
}
