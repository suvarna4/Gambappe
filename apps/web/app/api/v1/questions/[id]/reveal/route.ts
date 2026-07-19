/**
 * `GET /api/v1/questions/:slug/reveal` (design doc §6.7, §9.2). Auth `ghost+`. Returns `423
 * REVEAL_NOT_READY` before the question is ACTUALLY revealed — even if it's been graded
 * internally (publication rule, §6.5/§6.7: "nothing observable changes between settlement and
 * the synchronized reveal"). Uncacheable (viewer-specific block, §10.2).
 *
 * Lives under `[id]`, not `[slug]` — see the sibling `[id]/route.ts`'s header comment: App
 * Router requires one shared dynamic-segment name across sibling routes, and `[id]/picks`
 * (§9.2 `POST /questions/:id/picks`) is genuinely `:id`-keyed. Folder name only; the path
 * value captured here is still a slug, looked up via `getQuestionBySlug` below.
 */
import type { NextResponse } from 'next/server';
import { ApiError, now } from '@receipts/core';
import { getMarketById, getQuestionBySlug } from '@receipts/db';
import { jsonSuccess, runRoute } from '@/lib/api-response';
import { resolveIdentityFromRequest } from '@/lib/identity-request';
import { enforceGetBackstop } from '@/lib/rate-limit';
import { buildRevealPayload } from '@/lib/reveal-payload';
import { getDb, getRedis } from '@/lib/stores';

export const runtime = 'nodejs';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  return runRoute(async () => {
    const limited = await enforceGetBackstop(request);
    if (limited) return limited;

    const { identity } = await resolveIdentityFromRequest(request);
    if (identity.kind === 'anonymous') {
      throw new ApiError('UNAUTHENTICATED', 'a ghost or claimed profile is required');
    }

    const { id: slug } = await params;
    const db = getDb();
    const question = await getQuestionBySlug(db, slug);
    if (!question) throw new ApiError('NOT_FOUND', 'no such question');

    // Publication rule: gate on the RAW status — never the effective-state timestamp derivation
    // (§5.7 effective-state is a read-side presentation rule for `open`/`locked`; reveal is a
    // real, synchronized gate).
    if (question.status !== 'revealed') {
      throw new ApiError('REVEAL_NOT_READY', 'this question has not been revealed yet');
    }

    const market = await getMarketById(db, question.marketId);
    if (!market) throw new ApiError('INTERNAL', 'question references a missing market');

    const appUrl = process.env.NEXT_PUBLIC_APP_URL;
    if (!appUrl) throw new Error('NEXT_PUBLIC_APP_URL is not set (see .env.example)');

    const payload = await buildRevealPayload({
      db,
      redis: getRedis(),
      question,
      market,
      viewerProfileId: identity.profile.id,
      appUrl,
      at: now(),
    });

    const response = jsonSuccess(payload);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  });
}
