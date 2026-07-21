/**
 * `POST | DELETE /api/v1/topics/:category/follow` (journeys plan §4/§5 WS18-T2). Follow /
 * unfollow a market category for the stack feed. Ghost-allowed: the viewer's profile is resolved
 * (and a ghost minted if anonymous) exactly like the pick path, so follows persist per profile
 * for ghosts too. Flag-gated on `topic_markets` (404 when off — the feature doesn't exist yet).
 */
import type { NextResponse } from 'next/server';
import { ApiError, isFlagEnabled, topicFollowParamsSchema } from '@receipts/core';
import { clearFollow, setFollow } from '@receipts/db';
import { jsonError, jsonSuccess } from '@/lib/api-response';
import { assertSameOrigin } from '@/lib/origin-check';
import {
  applyIdentityCookies,
  resolveOrMintIdentity,
  type ResolvedOrMintedIdentity,
} from '@/lib/pick-identity';
import { enforceRateLimit } from '@/lib/rate-limit';
import { getDb } from '@/lib/stores';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ category: string }> };

async function handleFollow(
  request: Request,
  params: Ctx['params'],
  follow: boolean,
): Promise<NextResponse> {
  // Hoisted so a freshly-minted ghost's cookie is applied on any error path after minting
  // (same rationale as POST /questions/:id/picks).
  let resolved: ResolvedOrMintedIdentity | undefined;
  try {
    assertSameOrigin(request);
    if (!isFlagEnabled('topic_markets')) {
      throw new ApiError('NOT_FOUND', 'topic markets are not enabled');
    }

    const { category: rawCategory } = await params;
    const parsed = topicFollowParamsSchema.safeParse({ category: rawCategory });
    if (!parsed.success) throw new ApiError('VALIDATION_FAILED', 'unknown category');
    const { category } = parsed.data;

    resolved = await resolveOrMintIdentity(request);

    const rateLimited = await enforceRateLimit('topic_follow', resolved.profile.id);
    if (rateLimited) {
      applyIdentityCookies(rateLimited, resolved);
      return rateLimited;
    }

    if (follow) await setFollow(getDb(), resolved.profile.id, category);
    else await clearFollow(getDb(), resolved.profile.id, category);

    const response = jsonSuccess({ category, following: follow });
    applyIdentityCookies(response, resolved);
    return response;
  } catch (err) {
    const response = jsonError(err);
    if (resolved) applyIdentityCookies(response, resolved);
    return response;
  }
}

export function POST(request: Request, ctx: Ctx): Promise<NextResponse> {
  return handleFollow(request, ctx.params, true);
}

export function DELETE(request: Request, ctx: Ctx): Promise<NextResponse> {
  return handleFollow(request, ctx.params, false);
}
