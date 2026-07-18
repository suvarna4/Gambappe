/**
 * Web-push subscription schemas (design doc §13.2, §9.2). Flag `web_push`.
 */
import { z } from 'zod';

/** Standard PushSubscription JSON (§5.6 `push_subscriptions`). */
export const pushSubscriptionBodySchema = z
  .object({
    endpoint: z.string().url(),
    keys: z
      .object({
        p256dh: z.string().min(1),
        auth: z.string().min(1),
      })
      .strict(),
    expirationTime: z.number().nullable().optional(),
  })
  .strict();

export const pushSubscribeRequestSchema = z.object({ body: pushSubscriptionBodySchema });
export const pushSubscribeResponseSchema = z.object({ subscribed: z.literal(true) });

export const pushUnsubscribeRequestSchema = z.object({
  body: z.object({ endpoint: z.string().url() }).strict(),
});
export const pushUnsubscribeResponseSchema = z.object({ unsubscribed: z.literal(true) });
