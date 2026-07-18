/**
 * One-click unsubscribe token signing (design doc §13.2, WS9-T1) — split out of `notifications.ts`
 * because it's the only part of that file that needs `node:crypto`. `notifications.ts`'s pure
 * kind/category logic is imported from client components (WS7-T2's `ViewerStrip`, via
 * `apps/web/lib/format-et.ts`'s `@receipts/core` import); bundling `node:crypto` into a browser
 * bundle fails the Next.js build. This file is exported only via the `@receipts/core/server`
 * subpath (not the main barrel) so it's never reachable from client-bundled code — see
 * `package.json`'s `exports` field.
 *
 * SPEC-GAP(ws9-t1): the design doc says the unsubscribe link maps to the ProfileSettings PATCH
 * endpoint "or a simple one-click unsub route if that's cleaner." `PATCH /me/settings` requires
 * a claimed session cookie (§9.2), which a mail client's one-click POST (RFC 8058) or a link
 * clicked from a mail app can't supply — so a signed, stateless token is the only viable
 * mechanism for a link that works from inside an email. The token is verified by
 * `apps/web`'s `GET|POST /api/v1/notifications/unsubscribe` route (WS9-T1) but SIGNED by
 * `apps/worker` at send time (the email template needs the link), hence living here rather
 * than in `apps/web/lib` alone. Non-expiring by design (flipping one boolean is low-risk to
 * leave replayable indefinitely); revisit if that's judged too permissive.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { NotificationCategory } from './notifications.js';

export interface UnsubscribeTokenPayload {
  profileId: string;
  category: NotificationCategory;
}

function base64UrlEncode(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

function base64UrlDecode(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf8');
}

function sign(payloadB64: string, secret: string): string {
  return createHmac('sha256', secret).update(payloadB64).digest('hex');
}

/** Signs a one-click unsubscribe token for `profileId`'s given notification category. */
export function signUnsubscribeToken(
  payload: UnsubscribeTokenPayload,
  secret: string,
): string {
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  return `${payloadB64}.${sign(payloadB64, secret)}`;
}

/** Verifies a token minted by `signUnsubscribeToken`; `null` on any malformed/forged input. */
export function verifyUnsubscribeToken(
  token: string,
  secret: string,
): UnsubscribeTokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, signature] = parts as [string, string];
  const expected = sign(payloadB64, secret);
  const expectedBuf = Buffer.from(expected, 'hex');
  const actualBuf = Buffer.from(signature, 'hex');
  if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(base64UrlDecode(payloadB64));
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as Record<string, unknown>)['profileId'] === 'string' &&
      typeof (parsed as Record<string, unknown>)['category'] === 'string'
    ) {
      return parsed as UnsubscribeTokenPayload;
    }
    return null;
  } catch {
    return null;
  }
}
