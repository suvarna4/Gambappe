/**
 * `GET /api/v1/duos/:id` (design doc §9.2, WS6-T4): public duo page data — partners, tier,
 * rating, chemistry, match history. `auth: none` (spectator-visible like the nemesis matchup
 * page, INV-10). Behind the `duo_queue` flag (§4.6, §19.5) like every other duo surface — see
 * `../../duo/queue/route.ts` for the rationale. Business logic lives in
 * `@/lib/serialize-duo`'s `getDuoPublicPage` so the Next.js route stays thin (§4.3).
 */
import type { NextResponse } from 'next/server';
import { ApiError, getDuoRequestSchema, isFlagEnabled } from '@receipts/core';
import { jsonSuccess, runRoute } from '@/lib/api-response';
import { getDb } from '@/lib/stores';
import { DUO_MATCH_HISTORY_LIMIT, getDuoPublicPage } from '@/lib/serialize-duo';

export const runtime = 'nodejs';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  return runRoute(async () => {
    if (!isFlagEnabled('duo_queue')) {
      throw new ApiError('NOT_FOUND', 'duo pages are not available');
    }

    const { id } = getDuoRequestSchema.shape.params.parse(await params);

    const page = await getDuoPublicPage(getDb(), id, DUO_MATCH_HISTORY_LIMIT);
    if (!page) throw new ApiError('NOT_FOUND', 'duo not found');

    const response = jsonSuccess(page);
    response.headers.set('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=300');
    return response;
  });
}
