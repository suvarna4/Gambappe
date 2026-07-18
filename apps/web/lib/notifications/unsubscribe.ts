/**
 * One-click unsubscribe (§13.2 "List-Unsubscribe header", WS9-T1). See
 * `packages/core/src/notifications.ts`'s SPEC-GAP note for why this is a signed-token route
 * rather than the ProfileSettings PATCH endpoint: `PATCH /me/settings` requires a claimed
 * session cookie, which a mail client's one-click POST (RFC 8058) can't supply.
 *
 * The token only carries `{profileId, category}` — no `channel` — because this flow exists
 * for EMAIL specifically (the List-Unsubscribe header is an email-only mechanism); it always
 * flips `email_<category>`. Push has its own opt-in/out surface (`push_subscriptions`, the
 * subscribe/unsubscribe endpoints, WS9-T2) rather than a mailto-style unsubscribe link.
 */
import { profileSettingsSchema, type NotificationSettings } from '@receipts/core';
import { verifyUnsubscribeToken } from '@receipts/core/server';
import { getProfileById, updateProfileById, type Db } from '@receipts/db';

export type UnsubscribeResult =
  | { status: 'ok'; settingKey: keyof NotificationSettings }
  | { status: 'invalid_token' }
  | { status: 'profile_not_found' };

export async function runUnsubscribe(db: Db, token: string): Promise<UnsubscribeResult> {
  const secret = process.env.UNSUB_TOKEN_SECRET;
  if (!secret) throw new Error('UNSUB_TOKEN_SECRET is not set (see .env.example)');

  const payload = verifyUnsubscribeToken(token, secret);
  if (!payload) return { status: 'invalid_token' };

  const profile = await getProfileById(db, payload.profileId);
  if (!profile) return { status: 'profile_not_found' };

  const settingKey = `email_${payload.category}` as keyof NotificationSettings;
  const current = profileSettingsSchema.parse(profile.settings ?? {});
  const merged = profileSettingsSchema.parse({
    ...current,
    notifications: { ...current.notifications, [settingKey]: false },
  });
  await updateProfileById(db, profile.id, { settings: merged });

  return { status: 'ok', settingKey };
}
