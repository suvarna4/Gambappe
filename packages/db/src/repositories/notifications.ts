/**
 * `notifications` outbox repository (design doc §5.6, §13.2, WS9-T1).
 *
 * `sendNotification` is the cross-app integration point other workstreams' beat-wiring code
 * (WS9-T3) calls to enqueue an outbox row. It lives here — not in `apps/web` or `apps/worker`
 * — because BOTH apps need to call it: WS9-T3's beats fire almost entirely from worker jobs
 * (`reveal:fire`, `nemesis:assign`, `nemesis:conclude`, `streak:sweep`, `duo:*`, per §7.6's
 * owner column), and `apps/worker` cannot import from `apps/web` (§4.2: "nothing depends on
 * apps/*"). `apps/web` gets a same-signature convenience wrapper at
 * `apps/web/lib/notifications/send-notification.ts` for any web-side callers.
 *
 * THE STABLE INTEGRATION CONTRACT (documented for WS9-T3):
 *
 *   sendNotification(db, profileId, kind, payload, channel, dedupeKey?, scheduledAt?)
 *
 * `payload` is expected to carry a pre-rendered `line: string` (and optional `emphasis?:
 * string`) — i.e. the CALLER invokes `packages/engine`'s `narrate(beat, data)` (§13.3) at the
 * point the beat fires (where it has full typed trigger data) and stores the result here; the
 * outbox/dispatch layer (this file + `apps/worker/src/jobs/notify-dispatch.ts`) only knows how
 * to DELIVER a rendered line, not how to derive one from an untyped jsonb blob. See
 * `apps/worker/src/lib/notification-email-template.ts` for the rendering contract.
 */
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { now, type NotificationChannel } from '@receipts/core';
import type { Db } from '../client.js';
import { notifications, profiles, users } from '../schema/index.js';

export type NotificationRow = typeof notifications.$inferSelect;

export interface SendNotificationResult {
  id: string;
  /** false when a row with the same dedupe_key already existed — a silent no-op (§5.6: "an
   * insert with a colliding dedupe_key should be a silent no-op, not an error, since
   * notifications are naturally re-triggerable"). */
  inserted: boolean;
}

/**
 * Insert a queued outbox row. `dedupeKey` collisions are a silent no-op, never an error/throw
 * — a beat firing twice for the same trigger (e.g. a re-run job) must not double-send. Returns
 * the EXISTING row's id (with `inserted: false`) on a collision so callers still have a stable
 * id to log/trace.
 */
export async function sendNotification(
  db: Db,
  profileId: string,
  kind: string,
  payload: Record<string, unknown>,
  channel: NotificationChannel,
  dedupeKey?: string | null,
  scheduledAt: Date = now(),
): Promise<SendNotificationResult> {
  const id = uuidv7();
  const [row] = await db
    .insert(notifications)
    .values({
      id,
      profileId,
      kind,
      payload,
      channel,
      scheduledAt,
      status: 'queued',
      dedupeKey: dedupeKey ?? null,
    })
    .onConflictDoNothing({ target: notifications.dedupeKey })
    .returning({ id: notifications.id });

  if (row) return { id: row.id, inserted: true };

  // Conflict: dedupeKey must be non-null here — a null dedupe_key can never conflict (Postgres
  // unique indexes treat NULLs as distinct, and the insert above would have succeeded).
  const [existing] = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(eq(notifications.dedupeKey, dedupeKey as string))
    .limit(1);
  return { id: existing?.id ?? id, inserted: false };
}

/**
 * Queued, due (`scheduled_at <= at`) EMAIL notifications, oldest first, up to `limit`. Push
 * rows are queried separately by `listDueQueuedPushNotifications` below (WS9-T2).
 */
export async function listDueQueuedEmailNotifications(
  db: Db,
  at: Date,
  limit: number,
): Promise<NotificationRow[]> {
  return db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.status, 'queued'),
        eq(notifications.channel, 'email'),
        lte(notifications.scheduledAt, at),
      ),
    )
    .orderBy(asc(notifications.scheduledAt))
    .limit(limit);
}

/** Queued, due PUSH notifications, oldest first, up to `limit` (WS9-T2's `notify:dispatch`
 * extension — see this file's header: push rows sat untouched until this landed). */
export async function listDueQueuedPushNotifications(
  db: Db,
  at: Date,
  limit: number,
): Promise<NotificationRow[]> {
  return db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.status, 'queued'),
        eq(notifications.channel, 'push'),
        lte(notifications.scheduledAt, at),
      ),
    )
    .orderBy(asc(notifications.scheduledAt))
    .limit(limit);
}

/** Pushes `scheduled_at` forward without changing status — used for quiet-hours + daily-cap
 * deferral (§13.2). The row stays `queued` and is picked up again once its new time arrives. */
export async function rescheduleNotification(db: Db, id: string, scheduledAt: Date): Promise<void> {
  await db.update(notifications).set({ scheduledAt }).where(eq(notifications.id, id));
}

export async function markNotificationSent(db: Db, id: string, sentAt: Date): Promise<void> {
  await db.update(notifications).set({ status: 'sent', sentAt }).where(eq(notifications.id, id));
}

export async function markNotificationFailed(db: Db, id: string): Promise<void> {
  await db.update(notifications).set({ status: 'failed' }).where(eq(notifications.id, id));
}

export async function markNotificationCancelled(db: Db, id: string): Promise<void> {
  await db.update(notifications).set({ status: 'cancelled' }).where(eq(notifications.id, id));
}

/**
 * `kind` of every SENT email notification for `profileId` since `since` (a local-midnight
 * instant the caller resolves) — the caller filters by `isTransactionalNotificationKind` to
 * count today's non-transactional sends against `MARKETING_EMAIL_DAILY_CAP` (§13.2). Kept as a
 * plain kind list (not a count) so the transactional/non-transactional split stays in one
 * place (`@receipts/core`'s `notificationCategoryForKind`) instead of being re-implemented in
 * SQL here.
 */
export async function listSentEmailKindsSince(
  db: Db,
  profileId: string,
  since: Date,
): Promise<string[]> {
  const rows = await db
    .select({ kind: notifications.kind })
    .from(notifications)
    .where(
      and(
        eq(notifications.profileId, profileId),
        eq(notifications.channel, 'email'),
        eq(notifications.status, 'sent'),
        gte(notifications.sentAt, since),
      ),
    );
  return rows.map((r) => r.kind);
}

export interface NotificationEmailRecipient {
  email: string;
  /** IANA zone or null (defaults to SCHEDULE_TZ, §13.2). */
  timezone: string | null;
  /** Raw `profiles.settings` jsonb — caller parses with `profileSettingsSchema` (§9.4). */
  settings: unknown;
}

/**
 * The email address + prefs for a notification's `profile_id`, joined through `users` (only
 * claimed profiles have an email — DD-10: ghosts are never mailed). `null` when the profile is
 * a ghost, was never claimed with a verified email, or no longer exists.
 */
export async function getEmailRecipientForNotification(
  db: Db,
  profileId: string,
): Promise<NotificationEmailRecipient | null> {
  const [row] = await db
    .select({ email: users.email, timezone: profiles.timezone, settings: profiles.settings })
    .from(profiles)
    .innerJoin(users, eq(users.id, profiles.userId))
    .where(eq(profiles.id, profileId))
    .limit(1);
  if (!row || !row.email) return null;
  return { email: row.email, timezone: row.timezone, settings: row.settings };
}
