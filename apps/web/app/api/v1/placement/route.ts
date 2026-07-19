/**
 * `GET /api/v1/placement` (design doc §8.7, §9.2, §5.5, WS4-T8). 5 items sampled from active
 * `placement_items`, stratified so at least 3 distinct categories appear, WITHOUT outcomes.
 *
 * Auth `ghost+` (`packages/core/src/schemas/registry.ts` — a frozen contract). SPEC-GAP
 * (WS4-T8): the PRD frames placement as a "flow on entry," which reads like it should work for
 * a brand-new anonymous visitor, but this is a read-only GET and §6.1.1 scopes lazy ghost
 * minting to the three named *mutating* actions (first pick, reaction, or placement ANSWER —
 * explicitly "never on page view"). We follow the registry literally: an existing ghost/claimed
 * identity is required to view the placement set. `POST /placement/answers` is where the lazy
 * mint actually happens (matches `POST /reactions`, also `ghost+` in the registry despite being
 * a named lazy-mint trigger).
 */
import type { NextResponse } from 'next/server';
import { ApiError } from '@receipts/core';
import { jsonSuccess, runRoute } from '@/lib/api-response';
import { resolveIdentityFromRequest } from '@/lib/identity-request';
import { getActivePlacementItems, samplePlacementItems, toPublicPlacementItem } from '@/lib/placement-service';
import { enforceGetBackstop } from '@/lib/rate-limit';
import { getDb } from '@/lib/stores';

export const runtime = 'nodejs';

export async function GET(request: Request): Promise<NextResponse> {
  return runRoute(async () => {
    const limited = await enforceGetBackstop(request);
    if (limited) return limited;

    const { identity } = await resolveIdentityFromRequest(request);
    if (identity.kind === 'anonymous') {
      throw new ApiError('UNAUTHENTICATED', 'a ghost or claimed profile is required');
    }

    const pool = await getActivePlacementItems(getDb());
    const sampled = samplePlacementItems(pool);

    return jsonSuccess({ items: sampled.map(toPublicPlacementItem) });
  });
}
