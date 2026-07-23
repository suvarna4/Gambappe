/**
 * `GET /api/v1/pairings/:pairingId/banter` (docs/xtrace-hackathon-tasks.md XH-T6): 1–3 lines of
 * rivalry banter grounded in shared pairing memory, generated at most once per profile per ET
 * day. The segment is `[id]` (not `[pairingId]`) because `../route.ts` already owns that slug
 * name at this dynamic level and Next.js forbids two — `params.id` IS the pairing id.
 *
 * Cache check (step 4) happens BEFORE the rate limit (step 5) on purpose: generation is already
 * bounded to once per profile per ET day by the cache key, so the daily budget only guards the
 * generation (miss) path. Charging cache hits would 429 a viewer who opens `/rivals` more than
 * `RL_COMPANION_BANTER_PROFILE_D` times in one day, and the island's non-200 → render-nothing
 * rule would then silently hide the demo centerpiece for the rest of the day.
 */
import type { NextResponse } from 'next/server';
import {
  ApiError,
  etDateString,
  getBanterResponseSchema,
  getPairingRequestSchema,
  isFlagEnabled,
  now,
} from '@receipts/core';
import { jsonSuccess, runRoute } from '@/lib/api-response';
import { enforceGetBackstop, enforceRateLimit } from '@/lib/rate-limit';
import { resolveIdentityFromRequest } from '@/lib/identity-request';
import { getDb } from '@/lib/stores';
import {
  generateAndCacheBanter,
  getBanterCacheHit,
  getGenerator,
  getXtraceClient,
  loadPairingForBanter,
} from '@/lib/companion/banter';

export const runtime = 'nodejs';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  return runRoute(async () => {
    const limited = await enforceGetBackstop(request);
    if (limited) return limited;

    if (!isFlagEnabled('companion')) {
      throw new ApiError('NOT_FOUND', 'companion is not available');
    }

    const { identity } = await resolveIdentityFromRequest(request);
    if (identity.kind !== 'claimed') {
      throw new ApiError('UNAUTHENTICATED', 'a claimed profile is required');
    }

    const { id: pairingId } = getPairingRequestSchema.shape.params.parse(await params);
    const db = getDb();
    const profileId = identity.profile.id;

    const pairing = await loadPairingForBanter(db, pairingId, profileId);
    const at = now();
    const etDay = etDateString(at);

    const cached = await getBanterCacheHit(db, pairing, profileId, etDay);
    if (cached) return jsonSuccess(getBanterResponseSchema.parse({ banter: cached }));

    const rateLimited = await enforceRateLimit('companion_banter', profileId);
    if (rateLimited) return rateLimited;

    const banter = await generateAndCacheBanter(
      db,
      getXtraceClient(),
      getGenerator(),
      pairing,
      profileId,
      etDay,
      at,
    );
    return jsonSuccess(getBanterResponseSchema.parse({ banter }));
  });
}
