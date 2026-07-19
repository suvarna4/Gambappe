/**
 * `POST /api/share/token` (design doc §10.5, WS8-T2): mints the `?r=<opaque token>` share
 * attribution token the share sheet appends to page URLs it hands out (Web Share/copy-link/
 * download all use the same minted URL). Sibling of `/api/og/*` and `/api/cards/*` — see
 * `packages/core/src/schemas/share.ts`'s header comment on why this isn't in the §9.2
 * `API_CONTRACT` registry.
 *
 * No entity existence check: unlike the card/OG routes, minting a token needs no DB read at
 * all (same posture as `notifications-token.ts`'s unsubscribe token) — the token only encodes
 * `{artifact_kind, minted_at}`; the `targetId` isn't part of it because attribution only needs
 * to know WHICH KIND of surface a pick came from (§6.2 step 1: derives `source`), not which
 * specific entity. A forged/expired `targetId` in the surrounding URL 404s at the OG/card/page
 * route the same as it always would — the token doesn't need to duplicate that check.
 */
import { NextResponse } from 'next/server';
import { ApiError, errorEnvelope, nowMs, shareTokenBodySchema } from '@receipts/core';
import { assertSameOrigin } from '@/lib/origin-check';
import { clientIpKey, enforceRateLimit } from '@/lib/rate-limit';
import { mintShareToken } from '@/lib/share-token';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function rejected(err: ApiError): NextResponse {
  return NextResponse.json(errorEnvelope(err), {
    status: err.status,
    headers: { 'x-server-time': String(nowMs()) },
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    assertSameOrigin(request);
  } catch (err) {
    return rejected(err as ApiError);
  }

  const rateLimited = await enforceRateLimit('share_token', clientIpKey(request.headers));
  if (rateLimited) return rateLimited;

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return rejected(new ApiError('VALIDATION_FAILED', 'Body must be valid JSON'));
  }

  const parsed = shareTokenBodySchema.safeParse(json);
  if (!parsed.success) {
    return rejected(new ApiError('VALIDATION_FAILED', 'Invalid share-token request', parsed.error.flatten()));
  }

  const token = mintShareToken(parsed.data.artifact_kind);

  return NextResponse.json(
    { data: { token } },
    { status: 200, headers: { 'x-server-time': String(nowMs()), 'cache-control': 'no-store' } },
  );
}
