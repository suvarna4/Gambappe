/**
 * `notifications` outbox repository (design doc §5.6, §13.2, WS9-T3). Writing an outbox row is
 * WS9-T3 scope (beat wiring); actually sending it is not.
 *
 * SPEC-GAP(WS9-T3): channel dispatch (`notify:dispatch`, email/push sending, quiet-hours
 * deferral) is WS9-T1/T2 scope — this repository only writes the outbox row. `channel` is
 * hardcoded to `'email'` by callers at MVP (§13.2: push is V1, opt-in, not wired yet).
 */
import type { Db } from '../client.js';
import { notifications } from '../schema/index.js';

export type NotificationRow = typeof notifications.$inferSelect;
export type NewNotificationRow = typeof notifications.$inferInsert;

/**
 * Insert one outbox row, deduped on `dedupe_key`'s unique constraint (§5.6). A re-run that
 * already wrote this exact beat (e.g. a stale `reveal:fire` redelivery re-examining an
 * already-revealed question) is a silent, safe no-op — returns `null` instead of throwing or
 * duplicating the row. Callers should insert inside the same transaction as the state change
 * that triggered the beat (e.g. the reveal transaction) so a rolled-back trigger never leaves an
 * orphaned notification.
 */
export async function insertNotificationIfAbsent(
  db: Db,
  row: NewNotificationRow,
): Promise<NotificationRow | null> {
  const [inserted] = await db
    .insert(notifications)
    .values(row)
    .onConflictDoNothing({ target: notifications.dedupeKey })
    .returning();
  return inserted ?? null;
}
