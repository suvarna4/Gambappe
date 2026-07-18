/**
 * `GET /api/v1/questions/:slug` (design doc §9.2). Public. Any question by slug — same shape as
 * `/questions/today`; revealed questions include outcome + final split (publication rule gate
 * lives in `serializeQuestionPublic`, keyed off the RAW status, never the effective one).
 *
 * Lives under a Next.js `[id]` folder, not `[slug]` — the sibling `[id]/picks` route (§9.2
 * `POST /questions/:id/picks`) is genuinely `:id`-keyed per spec, and App Router requires every
 * sibling route at a given path position to share one dynamic-segment name. The folder name is
 * purely a Next.js routing-layer label; it doesn't change this endpoint's public URL shape or
 * the fact that the path value it captures is a slug, looked up via `getQuestionBySlug` below.
 */
import type { NextResponse } from 'next/server';
import { ApiError, now } from '@receipts/core';
import { getMarketById, getQuestionBySlug } from '@receipts/db';
import { jsonSuccess, runRoute } from '@/lib/api-response';
import { assertQuestionPubliclyVisible, serializeQuestionPublic } from '@/lib/serialize-question';
import { getDb } from '@/lib/stores';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  return runRoute(async () => {
    const { id: slug } = await params;
    const db = getDb();
    const question = await getQuestionBySlug(db, slug);
    if (!question) throw new ApiError('NOT_FOUND', 'no such question');
    assertQuestionPubliclyVisible(question);

    const market = await getMarketById(db, question.marketId);
    if (!market) throw new ApiError('INTERNAL', 'question references a missing market');

    const response = jsonSuccess(serializeQuestionPublic(question, market, now()));
    response.headers.set('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=300');
    return response;
  });
}
