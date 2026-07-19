/**
 * `GET|POST /api/v1/notifications/unsubscribe?token=...` (§13.2, WS9-T1): the one-click
 * unsubscribe link embedded in every notification email's `List-Unsubscribe` header (and
 * footer link). Deliberately NOT behind `assertSameOrigin`/session auth — it's meant to be hit
 * cross-origin from a mail client (RFC 8058 one-click POST) or a browser tab opened straight
 * from an email; the signed token IS the auth. Both verbs behave identically: GET covers a
 * human clicking the footer link, POST covers RFC 8058-compliant mail clients.
 *
 * SPEC-GAP(ws9-t1): no dedicated rate limit exists for this route in §14.1's table — a
 * forged/guessed token can only flip one boolean for one profile+category (no data
 * exfiltration, no destructive action), so it's left unlimited for now rather than inventing
 * an un-spec'd `RL_*` constant. Revisit if abuse is observed.
 *
 * SPEC-GAP(ws9-t1): returns a JSON envelope (consistent with the rest of `/api/v1`) rather
 * than a styled confirmation page — acceptable for T1's infra scope; a nicer landing page is a
 * cheap follow-up once `apps/web` has a `/settings`-adjacent page shell to match.
 */
import type { NextResponse } from 'next/server';
import { ApiError } from '@receipts/core';
import { jsonSuccess, runRoute } from '@/lib/api-response';
import { runUnsubscribe } from '@/lib/notifications/unsubscribe';
import { enforceGetBackstop } from '@/lib/rate-limit';
import { getDb } from '@/lib/stores';

async function handle(request: Request): Promise<NextResponse> {
  return runRoute(async () => {
    const token = new URL(request.url).searchParams.get('token');
    if (!token) {
      throw new ApiError('VALIDATION_FAILED', 'token query parameter is required');
    }

    const result = await runUnsubscribe(getDb(), token);
    if (result.status === 'invalid_token') {
      throw new ApiError('VALIDATION_FAILED', 'invalid or tampered unsubscribe token');
    }
    if (result.status === 'profile_not_found') {
      throw new ApiError('NOT_FOUND', 'profile not found');
    }

    return jsonSuccess({ unsubscribed: result.settingKey });
  });
}

export const runtime = 'nodejs';

export async function GET(request: Request): Promise<NextResponse> {
  // §14.1 "Any /api/v1 GET" backstop (audit 2.3) — GET only; the RFC 8058 one-click POST
  // below stays outside it (see the SPEC-GAP note above on this route's own limit).
  const limited = await enforceGetBackstop(request);
  if (limited) return limited;
  return handle(request);
}

/** RFC 8058 one-click unsubscribe: compliant mail clients POST here directly. */
export async function POST(request: Request): Promise<NextResponse> {
  return handle(request);
}
