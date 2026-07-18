/**
 * `GET /api/v1/questions/:slug/thread` (design doc §9.2). Public (`auth: none`) — posts +
 * reaction counts, paginated. Cacheable like every other public GET (§9.1).
 *
 * Lives under `[id]`, not `[slug]` — same reasoning as the sibling `[id]/route.ts` and
 * `[id]/reveal/route.ts` headers: App Router requires one shared dynamic-segment name across
 * sibling routes at this path position, and `[id]/posts` (§9.2 `POST /questions/:id/posts`) is
 * genuinely `:id`-keyed. The folder name is a routing-layer label only — the value captured here
 * is a slug, resolved via `getQuestionThreadPage` (which looks the question up by slug).
 */
import type { NextResponse } from 'next/server';
import { ApiError, paginationQuerySchema } from '@receipts/core';
import { jsonSuccess, runRoute } from '@/lib/api-response';
import { getQuestionThreadPage, THREAD_DEFAULT_LIMIT } from '@/lib/threads';
import { getDb } from '@/lib/stores';

export const runtime = 'nodejs';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  return runRoute(async () => {
    const { id: slug } = await params;

    const url = new URL(request.url);
    const query = paginationQuerySchema.parse({
      cursor: url.searchParams.get('cursor') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
    });

    const page = await getQuestionThreadPage(getDb(), slug, query.cursor, query.limit ?? THREAD_DEFAULT_LIMIT);
    if (!page) throw new ApiError('NOT_FOUND', 'no such question');

    const response = jsonSuccess(page);
    response.headers.set('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=300');
    return response;
  });
}
