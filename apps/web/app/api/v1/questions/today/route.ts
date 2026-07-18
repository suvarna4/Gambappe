/**
 * `GET /api/v1/questions/today` (design doc §9.2). Public, cacheable 10s. Today's daily
 * question by ET calendar date (§5.7 effective-state rule applied at serialization).
 */
import type { NextResponse } from 'next/server';
import { ApiError, etDateString, now } from '@receipts/core';
import { getDailyQuestion, getMarketById } from '@receipts/db';
import { jsonSuccess, runRoute } from '@/lib/api-response';
import { assertQuestionPubliclyVisible, serializeQuestionPublic } from '@/lib/serialize-question';
import { getDb } from '@/lib/stores';

export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  return runRoute(async () => {
    const db = getDb();
    const at = now();
    const question = await getDailyQuestion(db, etDateString(at));
    if (!question) throw new ApiError('NOT_FOUND', 'no daily question for today');
    assertQuestionPubliclyVisible(question);

    const market = await getMarketById(db, question.marketId);
    if (!market) throw new ApiError('INTERNAL', 'question references a missing market');

    const response = jsonSuccess(serializeQuestionPublic(question, market, at));
    response.headers.set('Cache-Control', 'public, s-maxage=10, stale-while-revalidate=30');
    return response;
  });
}
