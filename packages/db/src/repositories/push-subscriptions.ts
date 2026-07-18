/**
 * `push_subscriptions` repository (design doc §5.6, §13.2, WS9-T2). One row per browser
 * subscription (`endpoint` is globally unique — a browser install, not a profile). Revocation
 * is soft (`revoked_at`) rather than a delete: `notify:dispatch`'s push pass needs to tell "this
 * endpoint is gone, stop trying" (a 404/410 from the push service) apart from "never existed."
 */
import { and, eq, isNull } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { Db } from '../client.js';
import { pushSubscriptions } from '../schema/index.js';

export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;

export interface PushSubscriptionKeys {
  p256dh: string;
  auth: string;
}

/**
 * Re-subscribing the same `endpoint` (e.g. the browser refreshed its push registration, or a
 * different profile claimed the same device) reassigns `profile_id`/`keys` and un-revokes —
 * `onConflictDoUpdate` rather than `onConflictDoNothing`, since a stale `keys` blob would make
 * every future push to that endpoint fail encryption.
 */
export async function upsertPushSubscription(
  db: Db,
  profileId: string,
  endpoint: string,
  keys: PushSubscriptionKeys,
): Promise<PushSubscriptionRow> {
  const [row] = await db
    .insert(pushSubscriptions)
    .values({ id: uuidv7(), profileId, endpoint, keys })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { profileId, keys, revokedAt: null },
    })
    .returning();
  if (!row) throw new Error('upsertPushSubscription: no row returned');
  return row;
}

/** Soft-delete by endpoint alone, no profile check — for `notify:dispatch` when the push
 * service itself reports the endpoint gone (404/410, §5.6). NEVER call this for a user-
 * initiated unsubscribe: any caller who merely knows an endpoint string (e.g. from a leaked
 * log line or a shared device's history) could silently kill another profile's subscription.
 * The `DELETE /push/subscribe` route uses `revokePushSubscriptionByEndpointForProfile` below
 * instead, which scopes the update to the caller's own profile. Idempotent: revoking an
 * already-revoked or unknown endpoint is a silent no-op, not an error. */
export async function revokePushSubscriptionByEndpoint(db: Db, endpoint: string, at: Date): Promise<void> {
  await db
    .update(pushSubscriptions)
    .set({ revokedAt: at })
    .where(and(eq(pushSubscriptions.endpoint, endpoint), isNull(pushSubscriptions.revokedAt)));
}

/** User-initiated unsubscribe (§13.2): scoped to `profileId` so a claimed user can only ever
 * revoke their own subscriptions, never another profile's, even if they know its endpoint. */
export async function revokePushSubscriptionByEndpointForProfile(
  db: Db,
  profileId: string,
  endpoint: string,
  at: Date,
): Promise<void> {
  await db
    .update(pushSubscriptions)
    .set({ revokedAt: at })
    .where(
      and(
        eq(pushSubscriptions.endpoint, endpoint),
        eq(pushSubscriptions.profileId, profileId),
        isNull(pushSubscriptions.revokedAt),
      ),
    );
}

export async function listActivePushSubscriptionsForProfile(
  db: Db,
  profileId: string,
): Promise<PushSubscriptionRow[]> {
  return db
    .select()
    .from(pushSubscriptions)
    .where(and(eq(pushSubscriptions.profileId, profileId), isNull(pushSubscriptions.revokedAt)));
}
