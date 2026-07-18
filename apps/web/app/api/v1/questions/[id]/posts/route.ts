/**
 * `POST /api/v1/questions/:id/posts` (design doc §9.2). Auth: claimed only — ghosts can't post
 * (§5.6: "Claimed profiles only (enforced in API)"; there's no DB-level constraint since
 * `profiles.kind` isn't in the `posts` FK, so this route is the enforcement point). Rate limited
 * per §14.1: 20/day + 5/min per profile.
 */
import type { NextResponse } from 'next/server';
import { ApiError, createPostBodySchema, now, zQuestionId } from '@receipts/core';
import { jsonSuccess, runRoute } from '@/lib/api-response';
import { assertSameOrigin } from '@/lib/origin-check';
import { resolveIdentityFromRequest } from '@/lib/identity-request';
import { enforceRateLimit } from '@/lib/rate-limit';
import { createPost } from '@/lib/threads';
import { getDb } from '@/lib/stores';

export const runtime = 'nodejs';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  return runRoute(async () => {
    assertSameOrigin(request);

    const { identity } = await resolveIdentityFromRequest(request);
    if (identity.kind !== 'claimed') {
      throw new ApiError('UNAUTHENTICATED', 'a claimed profile is required');
    }

    // §14.1: posts 20/day + 5/min per profile — both checked, either can trip first.
    const dailyLimited = await enforceRateLimit('posts_daily', identity.profile.id);
    if (dailyLimited) return dailyLimited;
    const minuteLimited = await enforceRateLimit('posts_minute', identity.profile.id);
    if (minuteLimited) return minuteLimited;

    const { id: rawId } = await params;
    const questionIdParse = zQuestionId.safeParse(rawId);
    if (!questionIdParse.success) throw new ApiError('VALIDATION_FAILED', 'invalid question id');

    const body = createPostBodySchema.parse(await request.json());

    const post = await createPost(
      getDb(),
      {
        contextKind: 'question',
        contextId: questionIdParse.data,
        author: {
          profileId: identity.profile.id,
          handle: identity.profile.handle,
          slug: identity.profile.slug,
        },
        body: body.body,
      },
      now(),
    );
    if (!post) throw new ApiError('NOT_FOUND', 'no such question');

    return jsonSuccess({ post }, { status: 201 });
  });
}
