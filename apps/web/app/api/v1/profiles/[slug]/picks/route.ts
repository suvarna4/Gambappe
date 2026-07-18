/**
 * `GET /api/v1/profiles/:slug/picks` (design doc §9.2, §9.1 cursor pagination, WS7-T4). The
 * full public pick log (receipts culture, INV-6) — fully public (`auth: none`, INV-10), cursor
 * paginated. A `deleted` profile (or unknown slug) 404s (WS7-T4 AC).
 */
import type { NextResponse } from 'next/server';
import { ApiError, getProfilePicksRequestSchema } from '@receipts/core';
import { getDb } from '@/lib/stores';
import { getProfilePicksResponse, PROFILE_PICKS_DEFAULT_LIMIT } from '@/lib/profile-page';
import { jsonSuccess, runRoute } from '@/lib/api-response';

export const runtime = 'nodejs';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  return runRoute(async () => {
    const { slug } = getProfilePicksRequestSchema.shape.params.parse(await params);

    const url = new URL(request.url);
    const query = getProfilePicksRequestSchema.shape.query.parse({
      cursor: url.searchParams.get('cursor') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
    });

    const page = await getProfilePicksResponse(
      getDb(),
      slug,
      query.cursor,
      query.limit ?? PROFILE_PICKS_DEFAULT_LIMIT,
    );
    if (!page) throw new ApiError('NOT_FOUND', 'profile not found');

    // `page` already IS the §9.1 list envelope ({data, meta}) — it's the whole shape of
    // `getProfilePicksResponseSchema` (= listEnvelopeSchema(pickPublicSchema)), which per the
    // already-shipped convention (see threadResponseSchema, POST /events) describes what sits
    // under the OUTER success envelope's own `data` key, not the top-level wire body itself.
    // So this nests once: `{data: {data: [...picks], meta: {next_cursor}}}`.
    const response = jsonSuccess(page);
    response.headers.set('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=300');
    return response;
  });
}
