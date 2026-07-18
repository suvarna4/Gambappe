/**
 * Renders a queued notification's `payload` into a push `{title, body, url}` (§13.2, WS9-T2).
 * Same content contract as `notification-email-template.ts`: `payload.line` is the already-
 * narrated text (§13.3 `narrate()` output) — this file only wraps it, never derives it.
 */
import { notificationCategoryForKind, type NotificationCategory } from '@receipts/core';
import type { NotificationEmailPayload } from './notification-email-template.js';

const CATEGORY_TITLES: Record<NotificationCategory, string> = {
  reveal: "Tonight's reveal is in",
  nemesis: 'Nemesis week update',
  duo: 'Duo update',
  product: 'Receipts',
};

const CATEGORY_FALLBACK_BODIES: Record<NotificationCategory, string> = {
  reveal: 'The reveal is ready. Come see how it landed.',
  nemesis: 'Something moved in your nemesis week.',
  duo: 'Something moved with your duo.',
  product: "There's an update on your Receipts activity.",
};

export interface RenderedPush {
  title: string;
  body: string;
  url: string;
}

export function renderNotificationPush(kind: string, payload: NotificationEmailPayload): RenderedPush {
  const category = notificationCategoryForKind(kind);
  const title = payload.subject ?? CATEGORY_TITLES[category];
  const body = payload.line ?? CATEGORY_FALLBACK_BODIES[category];
  const url = payload.ctaUrl ?? '/';
  return { title, body, url };
}
