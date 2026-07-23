/**
 * Design-diff follow-up to WS25: `next-auth`'s server-action `signIn()` (`next-auth/src/lib/
 * actions.ts`) always calls `@auth/core`'s `Auth()` with a `raw` marker. Inside `Auth()`, when the
 * call is raw AND the thrown error is an `AuthError` (e.g. WS25-T4's `EmailSignInError`, thrown by
 * `sendVerificationRequest` on a rate-limit trip or transport failure), `Auth()` re-throws the raw
 * error instead of computing its usual `pages.error`/`pages.signIn` redirect (`auth.ts`'s `pages`
 * config is never consulted on this path). Uncaught, that crashes the Server Action itself
 * (Next.js's generic "Application error" boundary) instead of landing on `/claim?error=...`.
 *
 * This never showed up in WS25's own verification because every live check POSTed straight to the
 * `/api/auth/signin/email` route handler, which doesn't set `raw` — only the real
 * `<form action={signInWithEmail}>` in `ClaimEntry` does, via `next-auth`'s server-action `signIn`.
 *
 * `redirectOnAuthError` (called from `app/claim/actions.ts`'s `signInOrRedirect`) performs the
 * same redirect `Auth()` would have computed on the non-raw path. Extracted here (rather than
 * living in `actions.ts` directly) so it's testable under vitest without importing `../../auth` —
 * `auth.ts` itself can't be imported under vitest (see `auth-magic-link-send.ts`'s header).
 */
import { redirect, unstable_rethrow } from 'next/navigation';
import { AuthError } from '@auth/core/errors';

/**
 * `@auth/core`'s own non-raw redirect path masks every `AuthError` NOT in its `clientErrors`
 * allowlist down to `Configuration` (see `@auth/core/src/errors.ts`'s `clientErrors`/
 * `isClientError`) to avoid leaking internal error detail to the client. `EmailSignInError` (the
 * one actually verified reachable from this app's email-signin call, on a §14.1 rate-limit trip)
 * isn't on that allowlist, so `Configuration` is the accurate equivalent for it. One allowlisted
 * type IS technically reachable from the initial signin action too — `@auth/core`'s
 * `send-token.ts` throws `AccessDenied` if the `signIn` callback rejects — but `auth.ts`'s own
 * callback only ever rejects a `google` account, never `email`, so it's dormant today. If that
 * callback's gating ever changes to also reject email sign-ins, revisit whether `AccessDenied`
 * should forward its real type here instead of being masked, to stay accurate to what `Auth()`'s
 * non-raw path would have shown.
 */
export const SIGNIN_ERROR_REDIRECT = '/claim?error=Configuration';

/**
 * Call from a `catch` around `signIn(...)`. `unstable_rethrow` is Next.js's documented pattern
 * for wrapping an API that uses thrown errors for control flow (here, `signIn()`'s own internal
 * `redirect()` on its success path) before doing custom error handling — it re-throws
 * framework-internal errors (redirect, notFound, etc.) unchanged and no-ops on anything else, so
 * it never swallows a normal successful sign-in. Returns normally (doesn't throw or redirect) for
 * any error it doesn't recognize, leaving it to the caller to re-throw.
 */
export function redirectOnAuthError(err: unknown): void {
  unstable_rethrow(err);
  if (err instanceof AuthError) {
    redirect(SIGNIN_ERROR_REDIRECT);
  }
}
