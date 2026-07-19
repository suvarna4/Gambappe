/**
 * `POST /api/v1/questions/:id/picks` — the §6.2 core write path, implemented step by step:
 *
 *  0. Age gate (INV-9) — checked against the RESOLVED profile below (step 2 first: we need to
 *     know which profile's `age_attested_at` to check/set; the "0/1/2" numbering in §6.2
 *     describes requirements, not a strict call order — the first-pick UI already sends
 *     `age_attested:true` together with the side in one tap, so this never manifests as two
 *     round trips in practice).
 *  1. Parse body (zod, `.strict()`). `source` is never client-supplied — derived server-side
 *     (`derivePickSource`).
 *  2. Resolve identity; mint a ghost inside this request if anonymous (`resolveOrMintIdentity`).
 *  3. Early `QUESTION_LOCKED` on an already-non-open RAW status (cheap, avoids a wasted price
 *     fetch) — NOT the authoritative check (that's Postgres, inside `placePickTx`, immune to
 *     clock skew either direction).
 *  4. Price stamp (`resolvePickPriceStamp`, §6.2 step 4 ladder).
 *  5. `placePickTx` — `SELECT ... FOR SHARE` + insert + counter increment, one transaction.
 *  6. Respond 201 with pick + `undo_until`. Crowd counts are never in this response (§9.3).
 */
import type { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import {
  ApiError,
  UNDO_WINDOW_S,
  createPickBodySchema,
  isFlagEnabled,
  now,
  zQuestionId,
} from '@receipts/core';
import { getMarketById, getQuestionById, placePickTx, updateProfileById } from '@receipts/db';
import { jsonError, jsonSuccess } from '@/lib/api-response';
import { assertSameOrigin } from '@/lib/origin-check';
import { resolveOrMintIdentity, applyIdentityCookies, type ResolvedOrMintedIdentity } from '@/lib/pick-identity';
import { derivePickSource } from '@/lib/pick-source';
import { resolvePickPriceStamp } from '@/lib/price-stamp';
import { serializePick } from '@/lib/serialize-pick';
import { defaultVenueAdapters } from '@/lib/venues';
import { clientIpKey, enforceRateLimit } from '@/lib/rate-limit';
import { getDb, getRedis } from '@/lib/stores';

export const runtime = 'nodejs';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  // Hoisted out of the try block: a freshly-minted ghost's cookie must still be applied on any
  // error path reached AFTER minting (e.g. placePickTx throwing) — otherwise the just-inserted
  // profile row is orphaned (no cookie ever points at it) and the ghost-mint quota it consumed
  // is silently wasted, forcing a re-mint on retry.
  let resolved: ResolvedOrMintedIdentity | undefined;
  try {
    assertSameOrigin(request);

    // §14.1: pick 30/h/profile, 120/h/IP. IP check first — cheapest, needs no identity
    // resolution — same posture as POST /events (protect against a flood before doing work).
    const ipLimited = await enforceRateLimit('pick_create_ip', clientIpKey(request.headers));
    if (ipLimited) return ipLimited;

    const { id: rawId } = await params;
    const questionIdParse = zQuestionId.safeParse(rawId);
    if (!questionIdParse.success) throw new ApiError('VALIDATION_FAILED', 'invalid question id');
    const questionId = questionIdParse.data;

    const body = createPickBodySchema.parse(await request.json().catch(() => ({})));
    if (body.confidence !== undefined && !isFlagEnabled('confidence_slider')) {
      throw new ApiError('VALIDATION_FAILED', 'confidence is not enabled', { field: 'confidence' });
    }

    const db = getDb();
    const at = now();

    resolved = await resolveOrMintIdentity(request);

    const profileLimited = await enforceRateLimit('pick_create_profile', resolved.profile.id);
    if (profileLimited) {
      applyIdentityCookies(profileLimited, resolved);
      return profileLimited;
    }

    // §6.2 step 0 (INV-9).
    if (resolved.profile.ageAttestedAt === null) {
      if (body.age_attested !== true) {
        const response = jsonError(new ApiError('AGE_ATTESTATION_REQUIRED', '18+ attestation required for your first pick'));
        applyIdentityCookies(response, resolved);
        return response;
      }
      resolved.profile = await updateProfileById(db, resolved.profile.id, { ageAttestedAt: at });
    }

    const question = await getQuestionById(db, questionId);
    if (!question) {
      const response = jsonError(new ApiError('NOT_FOUND', 'no such question'));
      applyIdentityCookies(response, resolved);
      return response;
    }
    if (question.status !== 'open') {
      // Cheap, non-authoritative early-out on the RAW status (never on a timestamp comparison —
      // that would risk app-clock skew rejecting a pick Postgres would still accept, §6.2).
      const response = jsonError(new ApiError('QUESTION_LOCKED', 'this question is not open'));
      applyIdentityCookies(response, resolved);
      return response;
    }

    const market = await getMarketById(db, question.marketId);
    if (!market) {
      const response = jsonError(new ApiError('INTERNAL', 'question references a missing market'));
      applyIdentityCookies(response, resolved);
      return response;
    }

    const stamp = await resolvePickPriceStamp({
      db,
      redis: getRedis(),
      adapters: defaultVenueAdapters(),
      marketId: question.marketId,
      isVolatile: question.isVolatile,
      at,
    });
    if (!stamp) {
      const response = jsonError(new ApiError('PRICE_UNAVAILABLE', 'prices are catching up, try again in a minute'));
      applyIdentityCookies(response, resolved);
      return response;
    }

    const source = derivePickSource(request, question.slug ?? '');
    const result = await placePickTx(db, {
      id: randomUUID(),
      questionId,
      profileId: resolved.profile.id,
      side: body.side,
      yesPriceAtEntry: stamp.yesPrice,
      priceStampedAt: stamp.ts,
      pickedAt: at,
      source,
      confidence: body.confidence ?? null,
    });

    if (result.outcome === 'question_locked') {
      const response = jsonError(new ApiError('QUESTION_LOCKED', 'this question locked before your pick landed'));
      applyIdentityCookies(response, resolved);
      return response;
    }
    if (result.outcome === 'already_picked') {
      const response = jsonError(
        new ApiError('ALREADY_PICKED', 'you already picked this question', { pick: serializePick(result.pick) }),
      );
      applyIdentityCookies(response, resolved);
      return response;
    }

    const undoUntil = new Date(result.pick.pickedAt.getTime() + UNDO_WINDOW_S * 1000);
    const response = jsonSuccess(
      { pick: serializePick(result.pick), undo_until: undoUntil.toISOString() },
      { status: 201 },
    );
    applyIdentityCookies(response, resolved);
    return response;
  } catch (err) {
    const response = jsonError(err);
    if (resolved) applyIdentityCookies(response, resolved);
    return response;
  }
}
