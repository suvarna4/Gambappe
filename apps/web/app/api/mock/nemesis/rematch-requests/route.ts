/**
 * MOCK-ONLY route (design doc §19.3 WS7-T6). NOT part of the real `/api/v1` contract — see
 * `apps/web/lib/nemesis/mock-api.ts`'s header for the full explanation of why this exists.
 *
 * Why a route at all, instead of `RematchPanel.tsx` (a client component) calling
 * `mock-api.ts` functions directly: `@receipts/core` gained a `notifications.ts` module
 * (WS9-T1, merged after this task started) that imports `node:crypto` at module scope.
 * `@receipts/core` only exports one barrel entry point (no subpath exports in its
 * `package.json`), so ANY client-bundled import from `@receipts/core` — even just `ApiError`
 * — pulls that module into the browser bundle and fails webpack ("node:crypto ... Unhandled
 * scheme"). Route handlers run server-side only, so importing `@receipts/core` here is safe;
 * this route is the boundary that keeps `mock-api.ts` (and its `@receipts/core` imports) out
 * of client JS entirely. A nice side effect: `mock-api.ts`'s in-memory `rematchRequests` Map
 * is now a genuine single shared server-side store, verified end-to-end (create via this
 * route → accept via `[id]/accept/route.ts`, a different file) under `next build && next
 * start` — production mode, one persistent Node process, Node's module cache is shared
 * across all route handlers as expected.
 *
 * Caveat: under `next dev`, Next's on-demand-entries can evict/recompile an inactive route's
 * bundle, which resets that route's copy of this module's state (observed manually — a
 * request created here briefly wasn't visible to the accept route after enough idle time
 * passed between requests). This is a dev-server-only artifact, not a production concern for
 * this deployment topology (§2.2: `apps/web` runs as one persistent Node/Vercel process, not
 * literally per-route serverless isolation in a way that would reintroduce this). Still, an
 * in-memory Map is fundamentally not what WS5-T5's real implementation should look like
 * (Postgres, per §5.5 `rematch_requests`) — this mock's job is to prove out the UI/contract
 * shape, not to be a reliable datastore under all deployment models.
 */
import type { NextResponse } from 'next/server';
import { z } from 'zod';
import { jsonSuccess, runRoute } from '@/lib/api-response';
import { createRematchRequest } from '@/lib/nemesis/mock-api';

const bodySchema = z.object({
  requester_profile_id: z.string(),
  target_profile_id: z.string(),
});

export async function POST(request: Request): Promise<NextResponse> {
  return runRoute(async () => {
    const body = bodySchema.parse(await request.json());
    const result = createRematchRequest(body.requester_profile_id, body.target_profile_id);
    return jsonSuccess(result);
  });
}
