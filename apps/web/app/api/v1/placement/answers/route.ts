/**
 * `POST /api/v1/placement/answers` (design doc §8.7, §9.2, §5.5, §6.1.1, WS4-T8). Body
 * `{item_id, side}`; inserts/updates a `placement_answers` row and returns the per-item mini
 * reveal-loop result (historical outcome + crowd comparison) immediately — no held reveal for
 * placement, unlike daily questions (§6.7 doesn't apply here).
 *
 * Auth `ghost+`, but §6.1.1 names "placement answer" as one of the three actions that lazily
 * mint a ghost on the first mutating call ("first pick, reaction, or placement answer") — same
 * treatment as `POST /questions/:id/picks` (auth `none`, mints) and `POST /reactions` (also
 * `ghost+` in the registry, also a named lazy-mint trigger). So: anonymous → mint here, same
 * request, same as the pick flow.
 *
 * No age-gate here: INV-9's attestation requirement is scoped to "before any pick exists"
 * (`profiles.age_attested_at` column note, §5.2) and §6.2 step 0's age gate is specific to the
 * pick flow. Placement answers never touch the `picks` table, so that gate doesn't apply.
 *
 * After persisting the answer, recomputes `fingerprints.placement_prior` from ALL of this
 * profile's placement answers so far (§8.7) — see `seedPlacementPrior` for why "so far" rather
 * than gating on exactly 5.
 */
import type { NextResponse } from 'next/server';
import { ApiError, now, placementAnswerBodySchema } from '@receipts/core';
import { jsonSuccess, runRoute } from '@/lib/api-response';
import { assertSameOrigin } from '@/lib/origin-check';
import { resolveIdentityFromRequest } from '@/lib/identity-request';
import { mintGhostWithDb } from '@/lib/ghost-mint';
import { RedisGhostMintLimiter } from '@/lib/ghost-mint-limiter';
import { GHOST_COOKIE_NAME, clearedGhostCookieOptions, ghostCookieOptions } from '@/lib/ghost-cookie';
import {
  buildPlacementAnswerResult,
  clientIpFromRequest,
  getPlacementItemById,
  seedPlacementPrior,
  upsertPlacementAnswer,
} from '@/lib/placement-service';
import { getDb, getRedis } from '@/lib/stores';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<NextResponse> {
  return runRoute(async () => {
    assertSameOrigin(request);

    const { identity, clearGhostCookie } = await resolveIdentityFromRequest(request);
    const body = placementAnswerBodySchema.parse(await request.json().catch(() => ({})));
    const at = now();
    const db = getDb();

    let profileId: string;
    let mintedCookieValue: string | null = null;

    if (identity.kind === 'anonymous') {
      const minted = await mintGhostWithDb(
        db,
        clientIpFromRequest(request),
        new RedisGhostMintLimiter(getRedis()),
        at,
      );
      profileId = minted.profile.id;
      mintedCookieValue = minted.cookieValue;
    } else {
      profileId = identity.profile.id;
    }

    const item = await getPlacementItemById(db, body.item_id);
    if (!item) throw new ApiError('NOT_FOUND', 'placement item not found');

    await upsertPlacementAnswer(db, profileId, item.id, body.side, at);
    await seedPlacementPrior(db, profileId, at);

    const result = buildPlacementAnswerResult(item, body.side);

    const response = jsonSuccess(result);
    if (mintedCookieValue) {
      response.cookies.set(GHOST_COOKIE_NAME, mintedCookieValue, ghostCookieOptions());
    } else if (clearGhostCookie) {
      response.cookies.set(GHOST_COOKIE_NAME, '', clearedGhostCookieOptions());
    }
    return response;
  });
}
