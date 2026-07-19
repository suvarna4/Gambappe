/**
 * `GET /api/v1/pairings/:id` (design doc §9.2, §9.3, WS5-T4): public nemesis matchup page data
 * — both handles, daily-by-daily scoreboard (opponent picks masked pre-lock, §9.3), score,
 * winner. `auth: none` (spectator-visible, same posture as the duo public page, INV-10).
 * Behind the `nemesis` flag (§4.6). Business logic lives in `@/lib/nemesis/service` (§4.3).
 *
 * Static segments win over dynamic ones in Next.js route matching, so `../current/route.ts`
 * (a sibling literal segment) is matched before this `[id]` catch-all — `GET /pairings/current`
 * never falls through to here.
 */
import type { NextResponse } from 'next/server';
import { ApiError, getPairingRequestSchema, isFlagEnabled, now } from '@receipts/core';
import { jsonSuccess, runRoute } from '@/lib/api-response';
import { enforceGetBackstop } from '@/lib/rate-limit';
import { getDb } from '@/lib/stores';
import { getPairingPublicById } from '@/lib/nemesis/service';

export const runtime = 'nodejs';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  return runRoute(async () => {
    const limited = await enforceGetBackstop(request);
    if (limited) return limited;

    if (!isFlagEnabled('nemesis')) {
      throw new ApiError('NOT_FOUND', 'nemesis is not available');
    }

    const { id } = getPairingRequestSchema.shape.params.parse(await params);

    const pairing = await getPairingPublicById(getDb(), id, now());
    if (!pairing) throw new ApiError('NOT_FOUND', 'pairing not found');

    const response = jsonSuccess(pairing);
    response.headers.set('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=300');
    return response;
  });
}
