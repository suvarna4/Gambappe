/**
 * `GET /api/v1/questions/tomorrow` (design-diff audit vs. `docs/mockups/swipe-ux.html` +
 * `docs/swipe-ux-plan.md` §2.5's "under-card" AC — §9.2 contract-change). Public, cacheable 10s
 * (same posture as `GET /questions/today`, its sibling route). Powers the peeking next-day card
 * behind the committed receipt (`SwipeBallot`'s `pick` branch, via `ViewerStrip`'s client fetch)
 * — NOT the SSR shell (`QuestionStateView`/`DeckStage` stay exactly as they were, §10.2 INV-10),
 * so this route is the only new surface this feature needs.
 *
 * 404s `NOT_FOUND` — never a broken/empty 200 — whenever there's nothing safe to peek at:
 * curation hasn't reached tomorrow yet (the common case most days), the row is still `draft`, or
 * its effective status has already moved past `scheduled`. The client (`lib/tomorrow-peek-client
 * .ts`) treats any non-2xx as "nothing to show" and falls back to the flat `tomorrowTeaser`
 * banner — this route never needs to distinguish those cases for the caller.
 */
import type { NextResponse } from 'next/server';
import { ApiError, etDateString, now } from '@receipts/core';
import { getNextDailyQuestion } from '@receipts/db';
import { jsonSuccess, runRoute } from '@/lib/api-response';
import { enforceGetBackstop } from '@/lib/rate-limit';
import { serializeQuestionPeek } from '@/lib/serialize-question';
import { getDb } from '@/lib/stores';

export const runtime = 'nodejs';

export async function GET(request: Request): Promise<NextResponse> {
  return runRoute(async () => {
    const limited = await enforceGetBackstop(request);
    if (limited) return limited;

    const db = getDb();
    const at = now();
    const question = await getNextDailyQuestion(db, etDateString(at));
    const peek = question ? serializeQuestionPeek(question, at) : null;
    if (!peek) throw new ApiError('NOT_FOUND', 'no peekable question for tomorrow');

    const response = jsonSuccess(peek);
    response.headers.set('Cache-Control', 'public, s-maxage=10, stale-while-revalidate=30');
    return response;
  });
}
