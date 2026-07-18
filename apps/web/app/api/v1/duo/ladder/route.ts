/**
 * `GET /api/v1/duo/ladder` (design doc §8.10, §9.2, WS6-T4): tier standings, paginated,
 * `auth: none`. Behind the `duo_queue` flag (§4.6) like every other duo surface. Business logic
 * (ranking, cursor pagination) lives in `@/lib/duo-ladder`'s `getDuoLadderPage` so the route
 * stays thin (§4.3).
 */
import type { NextResponse } from 'next/server';
import { ApiError, getLadderRequestSchema, isFlagEnabled, now } from '@receipts/core';
import { jsonSuccess, runRoute } from '@/lib/api-response';
import { getDb } from '@/lib/stores';
import { getDuoLadderPage } from '@/lib/duo-ladder';

export const runtime = 'nodejs';

export async function GET(request: Request): Promise<NextResponse> {
  return runRoute(async () => {
    if (!isFlagEnabled('duo_queue')) {
      throw new ApiError('NOT_FOUND', 'the duo ladder is not available');
    }

    const url = new URL(request.url);
    const { query } = getLadderRequestSchema.parse({
      query: {
        cursor: url.searchParams.get('cursor') ?? undefined,
        limit: url.searchParams.get('limit') ?? undefined,
        tier: url.searchParams.get('tier') ?? undefined,
      },
    });

    const page = await getDuoLadderPage(getDb(), query, now());
    const response = jsonSuccess(page);
    response.headers.set('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=300');
    return response;
  });
}
