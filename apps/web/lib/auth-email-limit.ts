/**
 * Auth email-send rate limit (design doc §14.1: "Auth email sends | email+IP | 5/hour",
 * `RL_AUTH_EMAIL_H`; audit 2.4). Called by `auth.ts`'s `sendVerificationRequest` BEFORE any
 * magic-link dispatch (mailbox stub today, Resend once WS9 wires it) — the limit protects
 * against email-bombing a target address and provider-quota burn, so it must sit in front of
 * whatever the delivery mechanism is.
 *
 * Kept out of `auth.ts` so the throttle is unit/integration-testable without standing up the
 * whole Auth.js config (whose `sendVerificationRequest` is buried in the NextAuth closure).
 */
import { ApiError } from '@receipts/core';
import { clientIpKey, consumeRateLimit } from './rate-limit';

/**
 * Consumes one `auth_email_sends` token for `email`+IP; throws `ApiError('RATE_LIMITED')`
 * when exhausted. The email half of the key is trimmed/lowercased so casing variants of the
 * same address share one bucket (full §14.4 dots/plus normalization is an auth-layer
 * duplicate-account concern, not a limiter-key one). Auth.js surfaces the throw as its
 * standard EmailSignin error redirect — the send itself never happens.
 */
export async function enforceAuthEmailSendLimit(email: string, headers: Headers): Promise<void> {
  const key = `${email.trim().toLowerCase()}:${clientIpKey(headers)}`;
  const result = await consumeRateLimit('auth_email_sends', key);
  if (!result.allowed) {
    throw new ApiError('RATE_LIMITED', 'too many sign-in emails for this address — try again later');
  }
}
