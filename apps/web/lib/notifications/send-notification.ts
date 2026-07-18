/**
 * apps/web convenience wrapper around `@receipts/db`'s `sendNotification` (WS9-T1). Same
 * argument order as the documented integration contract, minus the `db` — this file's
 * `getDb()` singleton (see `lib/stores.ts`) supplies it, so web-side callers (settings routes,
 * claim flow, etc.) can call it exactly like the task brief's signature:
 *
 *   sendNotification(profileId, kind, payload, channel, dedupeKey?)
 *
 * Worker-side callers (WS9-T3's beat-wiring, which fires almost entirely from worker jobs —
 * reveal:fire, nemesis:assign/conclude, streak:sweep, duo:*, §7.6) CANNOT import this file
 * (`apps/worker` cannot depend on `apps/web`, §4.2) — they import `sendNotification` directly
 * from `@receipts/db` and pass their own `ctx.db` as the first argument. Both call sites end up
 * running the exact same insert/dedupe logic in `packages/db/src/repositories/notifications.ts`.
 */
import { sendNotification as dbSendNotification } from '@receipts/db';
import type { NotificationChannel } from '@receipts/core';
import { getDb } from '../stores';

export async function sendNotification(
  profileId: string,
  kind: string,
  payload: Record<string, unknown>,
  channel: NotificationChannel,
  dedupeKey?: string | null,
): Promise<{ id: string; inserted: boolean }> {
  return dbSendNotification(getDb(), profileId, kind, payload, channel, dedupeKey);
}
