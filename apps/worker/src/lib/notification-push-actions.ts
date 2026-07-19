/**
 * SW7-T1 · Axis-ordered web-push pick actions (swipe-ux-plan §2.11; design doc §13.2).
 *
 * A daily-open push can carry two notification actions so a subscriber picks straight from the
 * tray without opening the app. The order is the D-SW9 axis, same as the ballot's wells and the
 * swipe throw: AGAINST/`no` on the LEFT, FOR/`yes` on the RIGHT — `[✕ {no_label}] [{yes_label} ✓]`.
 * Keeping that order here (index 0 = left) means the notification, the card, and the swipe all
 * agree on which direction means what.
 *
 * Platform reality (§2.11 "honest platform scope"): notification actions render on Android/desktop
 * Chromium (and Firefox), but iOS Safari's Web Push shows none — its endpoints live on Apple's push
 * service, so `supportsNotificationActions` returns false for them and the dispatcher sends a
 * no-actions notification whose body ends with "tap to pick" and deep-links into the armed deck.
 *
 * Pure + dependency-free so the worker template, the transport, and the dispatcher can all agree on
 * one definition, and so the axis/host logic is unit-testable with no DB or browser.
 *
 * SPEC-GAP(SW7-T1): no job emits a `pick` payload yet — the daily-open push that would carry these
 * actions is not scheduled (`question:open`, apps/worker, sends no notification). This module + the
 * service worker are the ready mechanism; wiring the trigger is a follow-up (it needs a per-open
 * push beat, adjacent to WS9's reveal beats, out of the swipe-UX plan's SP3 scope).
 */

/** A single Web Notification action button (`NotificationAction` subset we set). */
export interface PushAction {
  action: string;
  title: string;
}

/** The `pick` descriptor a notification payload carries to request pick actions. */
export interface PickActionPayload {
  /** Question id for the `POST /api/v1/questions/:id/picks` the service worker fires. */
  questionId: string;
  yesLabel: string;
  noLabel: string;
  /** Deep link the tray tap / iOS fallback opens (the question permalink); the SW appends `arm=1`. */
  url?: string;
}

/** Action ids the service worker maps back to a `MarketSide`. Namespaced so a future non-pick
 * action never collides. */
export const PICK_ACTION_YES = 'pick:yes';
export const PICK_ACTION_NO = 'pick:no';

/** Appended to the body when a target can't render action buttons (iOS Safari, §2.11). */
export const PICK_TAP_FALLBACK_SUFFIX = ' — tap to pick';

/**
 * The two pick actions in D-SW9 axis order: `no` (against) first = left, `yes` (for) second =
 * right. The glyphs mirror the ballot wells (`✕` against, `✓` for).
 */
export function buildPickActions(
  pick: Pick<PickActionPayload, 'yesLabel' | 'noLabel'>,
): PushAction[] {
  return [
    { action: PICK_ACTION_NO, title: `✕ ${pick.noLabel}` },
    { action: PICK_ACTION_YES, title: `${pick.yesLabel} ✓` },
  ];
}

/**
 * Whether a push endpoint's platform renders notification action buttons. iOS Safari Web Push
 * (Apple's push service, `*.push.apple.com`) does not — everything else (FCM, Mozilla autopush,
 * WNS) does. A malformed endpoint is treated as capable: the worst case is actions a target
 * silently ignores, never a missing fallback on a platform that needed one.
 */
export function supportsNotificationActions(endpoint: string): boolean {
  let host: string;
  try {
    host = new URL(endpoint).host.toLowerCase();
  } catch {
    return true;
  }
  return host !== 'web.push.apple.com' && !host.endsWith('.push.apple.com');
}

/** Extract + validate the `pick` descriptor from a notification payload (null when absent or
 * missing a required field), so the template never emits half-built actions. */
export function parsePickActionPayload(pick: unknown): PickActionPayload | null {
  if (!pick || typeof pick !== 'object') return null;
  const p = pick as Record<string, unknown>;
  if (
    typeof p.questionId !== 'string' ||
    typeof p.yesLabel !== 'string' ||
    typeof p.noLabel !== 'string' ||
    p.questionId.length === 0
  ) {
    return null;
  }
  return {
    questionId: p.questionId,
    yesLabel: p.yesLabel,
    noLabel: p.noLabel,
    url: typeof p.url === 'string' ? p.url : undefined,
  };
}
