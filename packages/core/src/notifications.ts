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
 *
 * Pure, browser-safe (part of the main `@receipts/core` barrel — WS7-T2's `ViewerStrip` client
 * component imports this transitively). The unsubscribe-token signing that used to live in this
 * file needs `node:crypto` and now lives in `notifications-token.ts`, exported only via the
 * `@receipts/core/server` subpath, so a client bundle never pulls it in.
 */
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
