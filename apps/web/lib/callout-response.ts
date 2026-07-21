/**
 * Call-out route response helpers (WS20-T3). The call-out lifecycle needs two HTTP outcomes the
 * shared `ApiError` → status map (`@receipts/core`'s `ERROR_CODES`, Appendix C) can't express:
 *
 *  - **410 Gone** for an expired link — there is no 410 code in the core enum at all.
 *  - a **401 with a top-level `{reason: 'save_required'}`** discriminator for a ghost/anonymous
 *    visitor hitting accept, so the client (WS20-T4) can route them through the Save flow rather
 *    than showing a generic auth error.
 *
 * Rather than mint unrelated core codes (e.g. reusing `CLAIM_CONFLICT` for a call-out conflict,
 * which would be a misleading `code` in the body) or edit `packages/core` (out of scope for this
 * task — see the WS20-T3 report's contract-gap note), these build the clean `{error:{code,
 * message}}` envelope directly with call-out-scoped codes and the correct status, carrying the
 * same `x-server-time` header every other route response does (§9.1). If a 410/`GONE` code is
 * later added to core, these collapse back into `jsonError`.
 */
import { NextResponse } from 'next/server';
import { nowMs } from '@receipts/core';
import type { CalloutResolveReason } from './callouts';

function withServerTime(status: number): { status: number; headers: Record<string, string> } {
  return { status, headers: { 'x-server-time': String(nowMs()) } };
}

const REASON_TO_HTTP: Record<CalloutResolveReason, { status: number; code: string; message: string }> = {
  not_found: { status: 404, code: 'NOT_FOUND', message: 'call-out not found' },
  expired: { status: 410, code: 'CALLOUT_EXPIRED', message: 'this call-out link has expired' },
  already_resolved: {
    status: 409,
    code: 'CALLOUT_ALREADY_RESOLVED',
    message: 'this call-out has already been accepted or declined',
  },
  self_challenge: {
    status: 409,
    code: 'CALLOUT_SELF_CHALLENGE',
    message: 'you cannot accept your own call-out',
  },
};

/** Map a call-out lifecycle failure reason to its clean error response (404/409/410). */
export function calloutErrorResponse(reason: CalloutResolveReason): NextResponse {
  const { status, code, message } = REASON_TO_HTTP[reason];
  return NextResponse.json({ error: { code, message } }, withServerTime(status));
}

/**
 * 401 for a ghost/anonymous visitor hitting accept. The top-level `reason: 'save_required'` is
 * the WS20-T3 AC discriminator the client keys on to send them through Save (D-J8); the nested
 * `error` envelope keeps the shape consistent with every other error response.
 */
export function calloutSaveRequiredResponse(): NextResponse {
  return NextResponse.json(
    {
      error: { code: 'UNAUTHENTICATED', message: 'save your record to accept a call-out' },
      reason: 'save_required',
    },
    withServerTime(401),
  );
}
