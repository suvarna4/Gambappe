/**
 * `POST|DELETE /api/v1/push/subscribe` logic (design doc §13.2, WS9-T2), split out from the
 * route handler so it's testable without faking a next-auth session — mirrors `wallet-flow.ts`
 * (WS12) and `moderation.ts`'s (WS11-T3) split for the same reason.
 */
import { ApiError } from '@receipts/core';
import type { Db } from '@receipts/db';
import {
  listActivePushSubscriptionsForProfile,
  revokePushSubscriptionByEndpointForProfile,
  upsertPushSubscription,
} from '@receipts/db';

export interface SubscribePushInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Ops safety valve, not a product constant (mirrors `notify-dispatch.ts`'s DISPATCH_BATCH_SIZE
 * framing) — a claimed user has no legitimate reason to register more than a handful of
 * devices; without a cap, a hostile profile could register unbounded fake endpoints, each of
 * which `notify:dispatch`'s push pass would then POST to on every notification (review finding:
 * unbounded fan-out / SSRF-shaped surface). */
const MAX_ACTIVE_SUBSCRIPTIONS_PER_PROFILE = 10;

export async function subscribePush(
  db: Db,
  profileId: string,
  input: SubscribePushInput,
): Promise<{ subscribed: true }> {
  const active = await listActivePushSubscriptionsForProfile(db, profileId);
  const alreadySubscribedToThisEndpoint = active.some((s) => s.endpoint === input.endpoint);
  if (!alreadySubscribedToThisEndpoint && active.length >= MAX_ACTIVE_SUBSCRIPTIONS_PER_PROFILE) {
    throw new ApiError('VALIDATION_FAILED', `too many active push subscriptions (max ${MAX_ACTIVE_SUBSCRIPTIONS_PER_PROFILE})`);
  }

  await upsertPushSubscription(db, profileId, input.endpoint, input.keys);
  return { subscribed: true };
}

/** Scoped to `profileId` (§13.2 review finding) — a claimed user can only unsubscribe their
 * own endpoint, never one they merely know the URL of. */
export async function unsubscribePush(
  db: Db,
  profileId: string,
  endpoint: string,
  at: Date,
): Promise<{ unsubscribed: true }> {
  await revokePushSubscriptionByEndpointForProfile(db, profileId, endpoint, at);
  return { unsubscribed: true };
}
