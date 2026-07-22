/**
 * Auth email-send rate limit (design doc §14.1: "Auth email sends | email+IP | 5/hour",
 * `RL_AUTH_EMAIL_H`; audit 2.4). Called by `auth.ts`'s `sendVerificationRequest` BEFORE any
 * magic-link dispatch via the shared `@receipts/core/server` transport (WS25-T2/T3) — the limit
 * protects against email-bombing a target address and provider-quota burn, so it must sit in
 * front of whatever the delivery mechanism is.
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
 * duplicate-account concern, not a limiter-key one). WS25-T4: this `ApiError` is NOT itself an
 * Auth.js `AuthError` — it's `auth.ts`'s own `sendVerificationRequest` catch block that wraps it
 * into one, which is what actually produces a graceful redirect instead of Auth.js's generic
 * error page (empirically confirmed in `apps/web/test/auth-error-routing.test.ts`; a prior
 * version of this comment claimed the throw alone was sufficient, which wasn't true).
 */
export async function enforceAuthEmailSendLimit(email: string, headers: Headers): Promise<void> {
  const key = `${email.trim().toLowerCase()}:${clientIpKey(headers)}`;
  const result = await consumeRateLimit('auth_email_sends', key);
  if (!result.allowed) {
    throw new ApiError('RATE_LIMITED', 'too many sign-in emails for this address — try again later');
  }
}
