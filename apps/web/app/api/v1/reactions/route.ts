/**
 * `POST /api/v1/reactions` (design doc §9.2). Auth: `ghost+` — a ghost is minted lazily on the
 * first reaction just like a first pick (§6.1.1: "first pick, reaction, or placement answer"),
 * so this uses `resolveOrMintIdentity` (same as the picks route) rather than treating an
 * anonymous caller as an error. Toggle semantics: identical `{context_kind, context_id, emoji}`
 * twice in a row adds then removes. Rate limited per §14.1: 100/day per profile.
 */
import type { NextResponse } from 'next/server';
import { ApiError, createReactionBodySchema } from '@receipts/core';
import { jsonError, jsonSuccess } from '@/lib/api-response';
import { assertSameOrigin } from '@/lib/origin-check';
import { resolveOrMintIdentity, applyIdentityCookies, type ResolvedOrMintedIdentity } from '@/lib/pick-identity';
import { enforceRateLimit } from '@/lib/rate-limit';
import { submitReaction } from '@/lib/threads';
import { getDb } from '@/lib/stores';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<NextResponse> {
  // Hoisted for the same reason as the picks route: a freshly-minted ghost's cookie must be
  // applied on every response path reached after minting, error or not (§6.1.1).
  let resolved: ResolvedOrMintedIdentity | undefined;
  try {
    assertSameOrigin(request);

    const body = createReactionBodySchema.parse(await request.json());

    resolved = await resolveOrMintIdentity(request);

    const limited = await enforceRateLimit('reactions', resolved.profile.id);
    if (limited) {
      applyIdentityCookies(limited, resolved);
      return limited;
    }

    const result = await submitReaction(getDb(), {
      contextKind: body.context_kind,
      contextId: body.context_id,
      profileId: resolved.profile.id,
      emoji: body.emoji,
    });
    if (!result) {
      const response = jsonError(new ApiError('NOT_FOUND', 'no such context'));
      applyIdentityCookies(response, resolved);
      return response;
    }

    const response = jsonSuccess({ state: result });
    applyIdentityCookies(response, resolved);
    return response;
  } catch (err) {
    const response = jsonError(err);
    if (resolved) applyIdentityCookies(response, resolved);
    return response;
  }
}
