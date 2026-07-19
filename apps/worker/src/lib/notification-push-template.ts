/**
 * Renders a queued notification's `payload` into a push `{title, body, url}` (§13.2, WS9-T2).
 * Same content contract as `notification-email-template.ts`: `payload.line` is the already-
 * narrated text (§13.3 `narrate()` output) — this file only wraps it, never derives it.
 */
import {
  notificationCategoryForKind,
  PRODUCT_NAME,
  type NotificationCategory,
} from '@receipts/core';
import type { NotificationEmailPayload } from './notification-email-template.js';
import {
  buildPickActions,
  parsePickActionPayload,
  type PushAction,
} from './notification-push-actions.js';

const CATEGORY_TITLES: Record<NotificationCategory, string> = {
  reveal: "Tonight's reveal is in",
  nemesis: 'Nemesis week update',
  duo: 'Duo update',
  product: PRODUCT_NAME,
};

const CATEGORY_FALLBACK_BODIES: Record<NotificationCategory, string> = {
  reveal: 'The reveal is ready. Come see how it landed.',
  nemesis: 'Something moved in your nemesis week.',
  duo: 'Something moved with your duo.',
  product: `There's an update on your ${PRODUCT_NAME} activity.`,
};

export interface RenderedPush {
  title: string;
  body: string;
  url: string;
  /** SW7-T1: axis-ordered pick actions, present only when the payload carries a `pick` descriptor
   * (a daily-open push). Absent for every existing beat, so their serialized payload is unchanged. */
  actions?: PushAction[];
  /** SW7-T1: extra `notification.data` the service worker needs to act on a pick action (question
   * id + labels for the POST and the receipt line). `url` here is the deep-link tap target. */
  data?: Record<string, unknown>;
}

export function renderNotificationPush(
  kind: string,
  payload: NotificationEmailPayload,
): RenderedPush {
  const category = notificationCategoryForKind(kind);
  const title = payload.subject ?? CATEGORY_TITLES[category];
  const body = payload.line ?? CATEGORY_FALLBACK_BODIES[category];
  const url = payload.ctaUrl ?? '/';

  // SW7-T1: a daily-open push carries a `pick` descriptor → render axis-ordered actions
  // ([✕ {no}] [{yes} ✓]) and the data the SW POSTs with. `supportsNotificationActions` (in the
  // dispatcher, which knows the endpoint) drops these for iOS Safari.
  const pick = parsePickActionPayload(payload.pick);
  if (pick) {
    return {
      title,
      body,
      url,
      actions: buildPickActions(pick),
      data: {
        url: pick.url ?? url,
        questionId: pick.questionId,
        yesLabel: pick.yesLabel,
        noLabel: pick.noLabel,
      },
    };
  }

  return { title, body, url };
}
