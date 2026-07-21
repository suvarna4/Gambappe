/**
 * `GET /api/v1/stack` (journeys plan §4/§5 WS18-T1). The single mixed deck dealt on `/` (D-J2):
 * `{ headliner: QuestionPublic | null, topics: QuestionPublic[] }` per `stackFeedSchema`. Feed
 * assembly (the daily headliner + open topic cards in the viewer's followed categories, flag-gated
 * on `topic_markets`, serialized through the shared `serialize-question` path so no outcome leaks
 * pre-reveal) lives in `@/lib/stack-feed`, shared with the `/` server render.
 *
 * Viewer-specific (the topic set depends on the caller's follows), so the response is `private`,
 * never shared-cached. An invalid/stale ghost cookie is cleared, never surfaced as an error
 * (§6.1.1); an anonymous or ghost-less caller gets the all-categories default.
 */
import type { NextResponse } from 'next/server';
import { jsonSuccess, runRoute } from '@/lib/api-response';
import { resolveIdentityFromRequest } from '@/lib/identity-request';
import { GHOST_COOKIE_NAME, clearedGhostCookieOptions } from '@/lib/ghost-cookie';
import { enforceGetBackstop } from '@/lib/rate-limit';
import { assembleStackFeed } from '@/lib/stack-feed';
import { getDb } from '@/lib/stores';

export const runtime = 'nodejs';

export async function GET(request: Request): Promise<NextResponse> {
  return runRoute(async () => {
    const limited = await enforceGetBackstop(request);
    if (limited) return limited;

    const { identity, clearGhostCookie } = await resolveIdentityFromRequest(request);
    const viewerProfileId = identity.kind === 'anonymous' ? null : identity.profile.id;

    const feed = await assembleStackFeed(getDb(), { viewerProfileId });

    const response = jsonSuccess(feed);
    // Per-viewer (follows drive `topics`): never shared-cached.
    response.headers.set('Cache-Control', 'private, no-store');
    if (clearGhostCookie) {
      response.cookies.set(GHOST_COOKIE_NAME, '', clearedGhostCookieOptions());
    }
    return response;
  });
}
