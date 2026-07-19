/**
 * `GET /api/oembed?url=&format=` (design doc §10.5, §19.3 WS8-T4): the oEmbed discovery
 * endpoint linked from every public page's `<link rel="alternate" type="application/json+oembed">`
 * tag (`/q/[slug]`, `/p/[slug]`, `/vs/[pairingId]`).
 *
 * SSRF hardening (§10.5, §14.1 RT-B): `url` is parsed and pattern-matched only, never fetched —
 * see `lib/oembed/route-matcher.ts`'s header for the full threat model. A foreign host, an
 * internal/private-IP-shaped host, a non-`https:` absolute scheme, path traversal, or a path
 * that isn't one of the known route shapes all collapse to the same 404 a nonexistent-but-
 * well-formed slug gets — there is no distinguishable error signal an attacker could use to
 * probe the parser, and no code path here ever performs network I/O against `url`'s value.
 */
import { appUrl } from '@/lib/app-url';
import { ApiError, errorEnvelope, nowMs } from '@receipts/core';
import { buildOembedResponse } from '@/lib/oembed/response';
import { matchOembedUrl } from '@/lib/oembed/route-matcher';
import { clientIpKey, enforceRateLimit } from '@/lib/rate-limit';
import { getDb } from '@/lib/stores';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function notFound(): Response {
  const err = new ApiError('NOT_FOUND', 'not found');
  return Response.json(errorEnvelope(err), {
    status: err.status,
    headers: { 'x-server-time': String(nowMs()) },
  });
}

export async function GET(request: Request): Promise<Response> {
  // Same posture as `/api/og/*` (`lib/og/route-handler.ts`): the limiter runs before any DB
  // work so a flood of garbage `url=` values never reaches the database.
  const rateLimited = await enforceRateLimit('images', clientIpKey(request.headers));
  if (rateLimited) return rateLimited;

  const url = new URL(request.url);

  // oEmbed spec: an unsupported `format` must error rather than silently ignore the request.
  // Appendix C's error-code enum has no entry for the spec's suggested 501 (adding one is a
  // `packages/core` contract-change this task doesn't need) — SPEC-GAP(ws8-t4): folded into the
  // same NOT_FOUND response every other non-matching request gets, since json is the only
  // format this endpoint ever produces.
  const format = url.searchParams.get('format');
  if (format && format !== 'json') return notFound();

  const match = matchOembedUrl(url.searchParams.get('url'), appUrl());
  if (!match) return notFound();

  const body = await buildOembedResponse(getDb(), match, appUrl());
  if (!body) return notFound();

  return Response.json(body, {
    status: 200,
    headers: {
      'x-server-time': String(nowMs()),
      // Short-lived, unlike the `/api/og/*` images: unfurlers commonly re-poll and the response
      // is cheap (no render), so this doesn't need the immutable content-addressed treatment.
      'cache-control': 'public, max-age=300',
    },
  });
}
