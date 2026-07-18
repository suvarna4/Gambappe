/**
 * Notification classification + unsubscribe-token signing (design doc §13.2, §13.3, §9.4,
 * WS9-T1). Pure, dependency-free logic shared by BOTH `apps/worker` (which sends the emails —
 * `notify:dispatch`, most beats per §7.6) and `apps/web` (which owns the settings PATCH route
 * and the one-click unsubscribe link a mail client hits). `packages/engine`/`packages/db`
 * depend on `core`, but `apps/worker` cannot depend on `apps/web` or vice versa (§4.2) — so
 * anything both apps need to compute identically lives here, in the contract hub.
 *
 * Kind → category mapping: beat kinds (§13.3) are namespaced by prefix (`nemesis_*`, `duo_*`,
 * `reveal*`); everything else (`streak_*`, `called_it`, `claim_nudge_*`, and any future
 * non-transactional beat) falls into the catch-all `product` category — the only category with
 * no dedicated push setting, matching §9.4's ProfileSettings shape (push_reveal/push_nemesis/
 * push_duo only, no push_product; web push ships V1, DD-10).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { NotificationChannel } from './enums.js';
import type { NotificationSettings } from './schemas/settings.js';

export type NotificationCategory = 'reveal' | 'nemesis' | 'duo' | 'product';

/** Maps a beat/notification `kind` (§13.3 catalog key) to its settings category (§9.4). */
export function notificationCategoryForKind(kind: string): NotificationCategory {
  if (kind.startsWith('nemesis')) return 'nemesis';
  if (kind.startsWith('duo')) return 'duo';
  if (kind === 'reveal' || kind.startsWith('reveal_')) return 'reveal';
  return 'product';
}

/**
 * §13.2: "transactional beats (reveal/verdict) exempt [from the daily marketing cap] but
 * deduped by dedupe_key." Reveal, nemesis, and duo beats are transactional; everything else
 * (streak_*, called_it, claim_nudge_*, ...) is the non-transactional/"marketing-ish" bucket
 * subject to `MARKETING_EMAIL_DAILY_CAP`.
 */
export function isTransactionalNotificationKind(kind: string): boolean {
  return notificationCategoryForKind(kind) !== 'product';
}

/**
 * The `ProfileSettings.notifications` key gating this kind+channel, or `null` if that
 * combination has no user-facing opt-out (push has no "product" setting at MVP — see file
 * header). `notify:dispatch` treats a `null` result as "no explicit permission exists for
 * this" and does not send (§9.4 only defines push_reveal/push_nemesis/push_duo).
 */
export function notificationSettingsKey(
  kind: string,
  channel: NotificationChannel,
): keyof NotificationSettings | null {
  const category = notificationCategoryForKind(kind);
  if (channel === 'push' && category === 'product') return null;
  return `${channel}_${category}` as keyof NotificationSettings;
}

// --- One-click unsubscribe token (§13.2 "List-Unsubscribe header" + unsubscribe link) --------
//
// SPEC-GAP(ws9-t1): the design doc says the unsubscribe link maps to the ProfileSettings PATCH
// endpoint "or a simple one-click unsub route if that's cleaner." `PATCH /me/settings` requires
// a claimed session cookie (§9.2), which a mail client's one-click POST (RFC 8058) or a link
// clicked from a mail app can't supply — so a signed, stateless token is the only viable
// mechanism for a link that works from inside an email. The token is verified by
// `apps/web`'s `GET|POST /api/v1/notifications/unsubscribe` route (WS9-T1) but SIGNED by
// `apps/worker` at send time (the email template needs the link), hence living here rather
// than in `apps/web/lib` alone. Non-expiring by design (flipping one boolean is low-risk to
// leave replayable indefinitely); revisit if that's judged too permissive.

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
