/**
 * `notify:dispatch` (WS9-T1 owns email; WS9-T2 extends it with push; §7.6 "every 30s
 * (outbox)", §13.2). Picks up queued, due notifications and either sends them, defers them, or
 * cancels them.
 *
 * EMAIL (`channel = 'email'`):
 *  1. No linked/verified email for the recipient profile → `failed` (data anomaly; a claimed
 *     profile should always have one).
 *  2. Recipient opted out of this kind+channel (§9.4 ProfileSettings.notifications) → `cancelled`.
 *  3. Non-reveal kind scheduled inside quiet hours (§13.2, `lib/quiet-hours.ts`) → rescheduled
 *     to the next local QUIET_HOURS_END_LOCAL, stays `queued`.
 *  4. Non-transactional ("product") kind and the profile already hit `MARKETING_EMAIL_DAILY_CAP`
 *     sent today (local day) → rescheduled 24h out, stays `queued`.
 *  5. Otherwise: render + send via the injected `EmailTransport`; `sent` on success, `failed`
 *     on a thrown error (never crashes the batch — one bad row doesn't block the rest).
 *
 * PUSH (`channel = 'push'`, WS9-T2):
 *  1. No active `push_subscriptions` row for the profile → `cancelled` (unlike email, never
 *     having subscribed is the normal case, not a data anomaly).
 *  2. Recipient opted out of this kind+channel → `cancelled` (same settings check as email;
 *     `notificationSettingsKey` returns `null` for the `product` category on `push` — §9.4 has
 *     no `push_product` setting at all, so product-category push never sends).
 *  3. Non-reveal kind scheduled inside quiet hours → rescheduled, stays `queued` (§13.2's quiet
 *     hours rule isn't channel-specific; the `MARKETING_EMAIL_DAILY_CAP` IS email-specific by
 *     name and isn't applied to push).
 *  4. Otherwise: send to every active subscription for the profile (a user may have several
 *     devices) via the injected `PushTransport`. The outbox row is `sent` if at least one
 *     device accepted it, `failed` if every device errored. A 404/410 from any device revokes
 *     that device's `push_subscriptions` row (§5.6) regardless of the row's own outcome.
 *
 * 30s cadence: pg-boss cron is minute-granular (`registry.ts`'s file-header note). The minute
 * cron run processes the queue once, then self-requeues ONE follow-up run 30s later
 * (`singletonSeconds`-guarded so a duplicate cron fire or handler retry can't schedule two);
 * the follow-up run processes the queue again but does NOT self-requeue again — the next
 * minute's cron tick is the next chain start. Net: exactly two dispatch passes per minute.
 */
import {
  isTransactionalNotificationKind,
  MARKETING_EMAIL_DAILY_CAP,
  notificationCategoryForKind,
  notificationSettingsKey,
  now,
  PROFILE_SETTINGS_DEFAULTS,
  profileSettingsSchema,
  SCHEDULE_TZ,
} from '@receipts/core';
import { defaultEmailTransport, signUnsubscribeToken, type EmailTransport } from '@receipts/core/server';
import {
  getEmailRecipientForNotification,
  getProfileById,
  listActivePushSubscriptionsForProfile,
  listDueQueuedEmailNotifications,
  listDueQueuedPushNotifications,
  listSentEmailKindsSince,
  markNotificationCancelled,
  markNotificationFailed,
  markNotificationSent,
  rescheduleNotification,
  revokePushSubscriptionByEndpoint,
  type Db,
  type NotificationRow,
} from '@receipts/db';
import type { JobHandler } from '../heartbeat.js';
import { logger } from '../logger.js';
import { defaultPushTransport, type PushTransport } from '../lib/push-transport.js';
import { zonedDateString, zonedLocalTimeToUtc } from '../lib/day-window.js';
import {
  renderNotificationEmail,
  type NotificationEmailPayload,
} from '../lib/notification-email-template.js';
import { renderNotificationPush } from '../lib/notification-push-template.js';
import {
  PICK_TAP_FALLBACK_SUFFIX,
  supportsNotificationActions,
} from '../lib/notification-push-actions.js';
import { resolveQuietHoursDeferral } from '../lib/quiet-hours.js';

/** Bounds one dispatch pass — an ops safety valve, not a product constant (§0.1 rule 4 is about
 * product magic numbers; this is purely "don't let one tick run forever"). */
const DISPATCH_BATCH_SIZE = 100;

const SELF_REQUEUE_SECONDS = 30;
const SELF_REQUEUE_SINGLETON_KEY = 'notify-dispatch-tick';

interface UnsubscribeLinkConfig {
  secret: string;
  appUrl: string;
}

/** Read once per dispatch pass (not per-row) — a missing secret is a deploy misconfiguration
 * that should fail the whole job loudly (Sentry/heartbeat alert), not degrade into every row
 * independently failing with the same cause. */
function readUnsubscribeLinkConfig(): UnsubscribeLinkConfig {
  const secret = process.env.UNSUB_TOKEN_SECRET;
  if (!secret) throw new Error('UNSUB_TOKEN_SECRET is not set (see .env.example)');
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) throw new Error('NEXT_PUBLIC_APP_URL is not set (see .env.example)');
  return { secret, appUrl };
}

function buildUnsubscribeUrl(
  config: UnsubscribeLinkConfig,
  profileId: string,
  kind: string,
): string {
  const category = notificationCategoryForKind(kind);
  const token = signUnsubscribeToken({ profileId, category }, config.secret);
  return `${config.appUrl}/api/v1/notifications/unsubscribe?token=${encodeURIComponent(token)}`;
}

export interface NotifyDispatchReport {
  checked: number;
  sent: number;
  cancelledOptOut: number;
  deferredQuietHours: number;
  deferredMarketingCap: number;
  /** Includes both actual send failures and "no email recipient found" anomalies. */
  failed: number;
}

async function dispatchOne(
  db: Db,
  transport: EmailTransport,
  unsubscribeLinkConfig: UnsubscribeLinkConfig,
  row: NotificationRow,
  at: Date,
  report: NotifyDispatchReport,
): Promise<void> {
  const recipient = await getEmailRecipientForNotification(db, row.profileId);
  if (!recipient) {
    logger.warn(
      { notificationId: row.id, kind: row.kind },
      'notify:dispatch: no email recipient for profile (ghost or unclaimed) — marking failed',
    );
    await markNotificationFailed(db, row.id);
    report.failed++;
    return;
  }

  const settingsKey = notificationSettingsKey(row.kind, 'email');
  const parsedSettings = profileSettingsSchema.safeParse(recipient.settings ?? {});
  const notificationSettings = parsedSettings.success
    ? parsedSettings.data.notifications
    : PROFILE_SETTINGS_DEFAULTS.notifications;
  if (settingsKey !== null && notificationSettings[settingsKey] === false) {
    await markNotificationCancelled(db, row.id);
    report.cancelledOptOut++;
    return;
  }

  const timezone = recipient.timezone ?? SCHEDULE_TZ;
  const category = notificationCategoryForKind(row.kind);

  if (category !== 'reveal') {
    const deferUntil = resolveQuietHoursDeferral(row.scheduledAt, timezone);
    if (deferUntil) {
      await rescheduleNotification(db, row.id, deferUntil);
      report.deferredQuietHours++;
      return;
    }
  }

  if (!isTransactionalNotificationKind(row.kind)) {
    const localDateStr = zonedDateString(at, timezone);
    const localMidnight = zonedLocalTimeToUtc(localDateStr, 0, 0, timezone);
    const sentKinds = await listSentEmailKindsSince(db, row.profileId, localMidnight);
    const marketingSentToday = sentKinds.filter((k) => !isTransactionalNotificationKind(k)).length;
    if (marketingSentToday >= MARKETING_EMAIL_DAILY_CAP) {
      // SPEC-GAP(ws9-t1): §13.2 states the ≤1/day cap but not whether an excess notification
      // should be dropped or deferred to the next day. Deferring (rather than dropping)
      // preserves the beat instead of silently losing it — reasonable for a receipts/narration
      // product where a day-old streak/called-it line is still meaningful. Revisit if product
      // wants a hard drop instead.
      await rescheduleNotification(
        db,
        row.id,
        new Date(row.scheduledAt.getTime() + 24 * 3_600_000),
      );
      report.deferredMarketingCap++;
      return;
    }
  }

  try {
    const unsubscribeUrl = buildUnsubscribeUrl(unsubscribeLinkConfig, row.profileId, row.kind);
    const rendered = renderNotificationEmail(
      row.kind,
      (row.payload ?? {}) as NotificationEmailPayload,
      { unsubscribeUrl },
    );
    await transport.send({
      to: recipient.email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      headers: rendered.headers,
    });
    await markNotificationSent(db, row.id, at);
    report.sent++;
  } catch (err) {
    logger.warn({ err, notificationId: row.id, kind: row.kind }, 'notify:dispatch send failed');
    await markNotificationFailed(db, row.id);
    report.failed++;
  }
}

export async function runNotifyDispatch(
  db: Db,
  transport: EmailTransport,
  at: Date = now(),
): Promise<NotifyDispatchReport> {
  const report: NotifyDispatchReport = {
    checked: 0,
    sent: 0,
    cancelledOptOut: 0,
    deferredQuietHours: 0,
    deferredMarketingCap: 0,
    failed: 0,
  };

  const due = await listDueQueuedEmailNotifications(db, at, DISPATCH_BATCH_SIZE);
  report.checked = due.length;
  if (due.length === 0) return report; // no need to demand unsubscribe-link config for an empty pass

  const unsubscribeLinkConfig = readUnsubscribeLinkConfig();
  for (const row of due) {
    await dispatchOne(db, transport, unsubscribeLinkConfig, row, at, report);
  }

  return report;
}

export interface PushDispatchReport {
  checked: number;
  sent: number;
  cancelledOptOut: number;
  /** No active `push_subscriptions` row for the profile — never subscribed, not an anomaly. */
  cancelledNoSubscription: number;
  deferredQuietHours: number;
  /** Every device the row was sent to either errored or reported gone. */
  failed: number;
}

async function dispatchOnePush(
  db: Db,
  transport: PushTransport,
  row: NotificationRow,
  at: Date,
  report: PushDispatchReport,
): Promise<void> {
  const settingsKey = notificationSettingsKey(row.kind, 'push');
  const profile = await getProfileById(db, row.profileId);
  const parsedSettings = profileSettingsSchema.safeParse(profile?.settings ?? {});
  const notificationSettings = parsedSettings.success
    ? parsedSettings.data.notifications
    : PROFILE_SETTINGS_DEFAULTS.notifications;
  if (settingsKey === null || notificationSettings[settingsKey] === false) {
    await markNotificationCancelled(db, row.id);
    report.cancelledOptOut++;
    return;
  }

  const category = notificationCategoryForKind(row.kind);
  const timezone = profile?.timezone ?? SCHEDULE_TZ;
  if (category !== 'reveal') {
    const deferUntil = resolveQuietHoursDeferral(row.scheduledAt, timezone);
    if (deferUntil) {
      await rescheduleNotification(db, row.id, deferUntil);
      report.deferredQuietHours++;
      return;
    }
  }

  const subscriptions = await listActivePushSubscriptionsForProfile(db, row.profileId);
  if (subscriptions.length === 0) {
    await markNotificationCancelled(db, row.id);
    report.cancelledNoSubscription++;
    return;
  }

  const rendered = renderNotificationPush(
    row.kind,
    (row.payload ?? {}) as NotificationEmailPayload,
  );
  const hasPickActions = (rendered.actions?.length ?? 0) > 0;
  let anySent = false;
  for (const subscription of subscriptions) {
    try {
      // SW7-T1: pick actions render on Android/desktop Chromium + Firefox; iOS Safari (Apple push
      // endpoints) shows none, so for those we drop the buttons and end the body with "tap to
      // pick" — the SW's body-tap deep-links into the armed deck instead. `data` still rides along
      // on every platform so that deep link knows where to go.
      const renderActionsHere =
        hasPickActions && supportsNotificationActions(subscription.endpoint);
      const result = await transport.send({
        subscription: {
          endpoint: subscription.endpoint,
          keys: subscription.keys as { p256dh: string; auth: string },
        },
        title: rendered.title,
        body:
          hasPickActions && !renderActionsHere
            ? rendered.body + PICK_TAP_FALLBACK_SUFFIX
            : rendered.body,
        url: rendered.url,
        ...(renderActionsHere ? { actions: rendered.actions } : {}),
        ...(rendered.data ? { data: rendered.data } : {}),
      });
      if (result.revoked) {
        await revokePushSubscriptionByEndpoint(db, subscription.endpoint, at);
      } else {
        anySent = true;
      }
    } catch (err) {
      logger.warn(
        { err, notificationId: row.id, kind: row.kind },
        'notify:dispatch push send failed for one device',
      );
    }
  }

  if (anySent) {
    await markNotificationSent(db, row.id, at);
    report.sent++;
  } else {
    await markNotificationFailed(db, row.id);
    report.failed++;
  }
}

export async function runPushNotifyDispatch(
  db: Db,
  transport: PushTransport,
  at: Date = now(),
): Promise<PushDispatchReport> {
  const report: PushDispatchReport = {
    checked: 0,
    sent: 0,
    cancelledOptOut: 0,
    cancelledNoSubscription: 0,
    deferredQuietHours: 0,
    failed: 0,
  };

  const due = await listDueQueuedPushNotifications(db, at, DISPATCH_BATCH_SIZE);
  report.checked = due.length;
  for (const row of due) {
    await dispatchOnePush(db, transport, row, at, report);
  }

  return report;
}

interface NotifyDispatchJobData {
  /** Set on the self-requeued 30s-later run so it doesn't chain a further self-requeue. */
  selfRequeue?: boolean;
}

export const notifyDispatchHandler: JobHandler = async (ctx, data) => {
  const transport = defaultEmailTransport(logger);
  const report = await runNotifyDispatch(ctx.db, transport);
  logger.info({ report }, 'notify:dispatch complete');

  const pushTransport = defaultPushTransport();
  const pushReport = await runPushNotifyDispatch(ctx.db, pushTransport);
  logger.info({ report: pushReport }, 'notify:dispatch (push) complete');

  const jobData = (data ?? {}) as NotifyDispatchJobData;
  if (!jobData.selfRequeue) {
    await ctx.boss.send('notify:dispatch', { selfRequeue: true } satisfies NotifyDispatchJobData, {
      startAfter: SELF_REQUEUE_SECONDS,
      singletonSeconds: SELF_REQUEUE_SECONDS,
      singletonKey: SELF_REQUEUE_SINGLETON_KEY,
    });
  }
};
