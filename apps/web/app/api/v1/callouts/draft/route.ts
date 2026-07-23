/**
 * `POST /api/v1/callouts/draft` (docs/xtrace-hackathon-tasks.md XH-T7): a few AI-drafted
 * callout-message lines for a claimed challenger to send a target rival, generated at most once
 * per challenger/target pair per ET day. The in-app callout contract itself (`callouts` table,
 * `createCalloutBodySchema`) is untouched — this route only produces share TEXT, never a
 * message field on the callout row.
 *
 * Cache check happens BEFORE the rate limit for the same reason as the banter route (XH-T6):
 * generation is already bounded to once per pair per ET day by the cache key, so the daily
 * budget only guards the generation (miss) path.
 */
import type { NextResponse } from 'next/server';
import {
  ApiError,
  draftCalloutBodySchema,
  draftCalloutResponseSchema,
  etDateString,
  isFlagEnabled,
  now,
} from '@receipts/core';
import { jsonSuccess, runRoute } from '@/lib/api-response';
import { assertSameOrigin } from '@/lib/origin-check';
import { resolveIdentityFromRequest } from '@/lib/identity-request';
import { enforceRateLimit } from '@/lib/rate-limit';
import { getDb } from '@/lib/stores';
import { getGenerator, getXtraceClient } from '@/lib/companion/banter';
import {
  authorizeDraftTarget,
  generateAndCacheCalloutDraft,
  getDraftCacheHit,
} from '@/lib/companion/callout-draft';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<NextResponse> {
  return runRoute(async () => {
    assertSameOrigin(request);
    if (!isFlagEnabled('callout_draft')) {
      throw new ApiError('NOT_FOUND', 'callout drafting is not available');
    }

    const { identity } = await resolveIdentityFromRequest(request);
    if (identity.kind !== 'claimed') {
      throw new ApiError('UNAUTHENTICATED', 'a claimed profile is required');
    }

    const raw = await request.json().catch(() => ({}));
    const { target_profile_id: targetProfileId } = draftCalloutBodySchema.parse(raw);

    const db = getDb();
    const challengerProfileId = identity.profile.id;
    const priorPairingIds = await authorizeDraftTarget(db, challengerProfileId, targetProfileId);

    const at = now();
    const etDay = etDateString(at);

    const cached = await getDraftCacheHit(db, challengerProfileId, targetProfileId, etDay);
    if (cached) return jsonSuccess(draftCalloutResponseSchema.parse({ drafts: cached }));

    const limited = await enforceRateLimit('callout_draft', challengerProfileId);
    if (limited) return limited;

    const drafts = await generateAndCacheCalloutDraft(
      db,
      getXtraceClient(),
      getGenerator(),
      challengerProfileId,
      targetProfileId,
      priorPairingIds,
      etDay,
    );
    return jsonSuccess(draftCalloutResponseSchema.parse({ drafts }));
  });
}
