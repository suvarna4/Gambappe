/**
 * The full body of `auth.ts`'s `sendVerificationRequest` (WS25-T3/T4), extracted into its own
 * file — this is the one piece of Auth.js config that doesn't need `next-auth` itself (only
 * `@auth/core/errors`, which has no dependency on `next`/`next/server`), so pulling it out makes
 * it directly testable under vitest. `auth.ts` can't be imported under vitest at all (it pulls
 * in `next-auth`, which pulls in `next/server` in a way this repo's test runner can't resolve —
 * see `identity-request.ts`'s header comment) and so, before this file existed, nothing had ever
 * exercised the REAL wiring between the rate limit, the shared transport, and the T4 error
 * wrapping together — only each piece in isolation (WS25-T5; see
 * `apps/web/test/auth-magic-link-send.test.ts`, which sets `RESEND_API_KEY`/`EMAIL_FROM` and
 * mocks `fetch` to exercise the real `ResendEmailTransport` path, not just the always-available
 * logging stub).
 */
import { EmailSignInError } from '@auth/core/errors';
import { MAGIC_LINK_TTL_MIN } from '@receipts/core';
import { defaultEmailTransport } from '@receipts/core/server';
import { enforceAuthEmailSendLimit } from './auth-email-limit';
import { renderMagicLinkEmail } from './auth-email-template';
import { logger } from './logger';

/**
 * WS25-T4: the rate limit, the transport's own misconfiguration throw (missing `EMAIL_FROM`
 * while `RESEND_API_KEY` is set), and a real Resend send failure are all failures with the
 * identical underlying problem: an error that isn't an `@auth/core` `AuthError` subclass makes
 * Auth.js default to its generic `/api/auth/error?error=Configuration` page (empirically
 * confirmed, not assumed — `apps/web/test/auth-error-routing.test.ts` — a prior version of the
 * rate-limit comment here claimed that throw already got "Auth.js's normal EmailSignin error
 * redirect," which that test proves false: a plain `ApiError` routes to the generic page exactly
 * like an unwrapped transport failure does). One catch normalizes all three into the same
 * graceful, retry-inviting redirect.
 */
export async function sendMagicLinkEmail(
  identifier: string,
  url: string,
  headers: Headers,
): Promise<void> {
  try {
    // §14.1 "Auth email sends | email+IP | 5/hour" (audit 2.4), enforced BEFORE any dispatch.
    await enforceAuthEmailSendLimit(identifier, headers);

    // WS25-T3: real send via the shared transport (§13.2, `@receipts/core/server`). No
    // `NODE_ENV` branch here — `defaultEmailTransport()` already selects the real Resend
    // transport when `RESEND_API_KEY` is set and a non-production logging stub otherwise (never
    // logs `identifier`/the recipient email itself, §16.2), so this call is identical in every
    // environment; only the transport underneath it differs. Also covers
    // `defaultEmailTransport()`'s own synchronous throw when `RESEND_API_KEY` is set but
    // `EMAIL_FROM` is missing — that call is inside this same try block.
    const { subject, html, text } = renderMagicLinkEmail(url, MAGIC_LINK_TTL_MIN);
    await defaultEmailTransport(logger).send({ to: identifier, subject, html, text });
  } catch (err) {
    // Never logs `identifier`/the recipient email (§16.2) — only the failure itself.
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err: message }, 'sendVerificationRequest failed');
    // `AuthError`'s published .d.ts only declares the plain `Error(message, options)` shape
    // (its richer runtime constructor isn't reflected in the type declarations), hence
    // `{ cause: err }` rather than passing `err` itself as the first argument.
    throw new EmailSignInError(message, { cause: err });
  }
}
