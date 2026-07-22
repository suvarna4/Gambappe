/**
 * WS25-T4: empirically confirms (against the real `@auth/core` library, not a guess) which
 * thrown-error shape makes Auth.js redirect a failed `sendVerificationRequest` to a graceful,
 * retry-inviting page rather than its generic `/error?error=Configuration` page (the original
 * bug this whole WS25 effort exists to fix). `@auth/core` has no dependency on `next`/
 * `next/server` (unlike `next-auth`, which `auth.ts` itself can't be imported under vitest for —
 * see `identity-request.ts`'s header comment), so it's directly testable here.
 *
 * `skipCSRFCheck` avoids needing a real cookie/token round-trip just to reach
 * `sendVerificationRequest` — this suite only cares about what happens AFTER that handler
 * throws, not CSRF handling itself (already covered by `enforceAuthEmailSendLimit` and Auth.js's
 * own tests).
 */
import { describe, expect, it } from 'vitest';
import { Auth, skipCSRFCheck, type AuthConfig } from '@auth/core';
import { EmailSignInError } from '@auth/core/errors';
import { ApiError } from '@receipts/core';

const fakeAdapter = {
  getUserByEmail: async () => null,
  createVerificationToken: async () => undefined,
  useVerificationToken: async () => null,
};

/**
 * A plain `EmailConfig`-shaped provider object, not `next-auth/providers/nodemailer`'s
 * `Nodemailer()` factory — that factory's only real job is validating `server` is truthy and
 * defaulting a few fields; building the object directly here avoids a real `nodemailer` package
 * dependency (an `@auth/core` peer dep `apps/web` doesn't otherwise need) for what amounts to a
 * config literal.
 */
function buildConfig(sendVerificationRequest: () => Promise<void>): AuthConfig {
  return {
    secret: 'test-secret-at-least-this-long-for-auth-js',
    trustHost: true,
    basePath: '/api/auth',
    skipCSRFCheck,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal test double, not the real DrizzleAdapter shape
    adapter: fakeAdapter as any,
    providers: [
      {
        id: 'email',
        type: 'email',
        name: 'Email',
        server: { host: 'localhost', port: 25, auth: { user: '', pass: '' } },
        from: 'noreply@example.com',
        maxAge: 15 * 60,
        sendVerificationRequest,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal test double
      } as any,
    ],
  };
}

async function postEmailSignIn(config: AuthConfig): Promise<Response> {
  return Auth(
    new Request('https://example.com/api/auth/signin/email', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ email: 'user@example.com' }),
    }),
    config,
  );
}

/**
 * A `sendVerificationRequest` mock that rejects. A plain `async () => { throw error }` mock
 * reproduces a real Node "unhandled rejection" (confirmed: reverting to that shape locally
 * brings back `PromiseRejectionHandledWarning`s and a nonzero exit code) even though
 * `@auth/core`'s own `sendToken()` DOES eventually await this same promise via
 * `Promise.all([sendRequest, createToken])` a few synchronous lines later — an async function's
 * throw doesn't synchronously reject its returned promise (it settles via a microtask), so
 * there's a real window where Node's unhandled-rejection sweep can run before that later
 * `Promise.all` call attaches its handler. Pre-attaching a no-op `.catch()` here marks the
 * promise handled immediately, synchronously, without affecting `Promise.all`'s own independent
 * subscription to the same promise object.
 */
function rejectingSend(error: Error): () => Promise<void> {
  return () => {
    const rejected = Promise.reject(error);
    rejected.catch(() => {});
    return rejected;
  };
}

describe('Auth.js redirect routing on a sendVerificationRequest failure (WS25-T4)', () => {
  it('a raw Error (the pre-fix throw shape) routes to the generic /error page', async () => {
    const res = await postEmailSignIn(buildConfig(rejectingSend(new Error('boom'))));
    const location = new URL(res.headers.get('location')!);
    expect(location.pathname).toBe('/api/auth/error');
    expect(location.searchParams.get('error')).toBe('Configuration');
  });

  it('an EmailSignInError instead routes back to the sign-in page (graceful, retry-inviting)', async () => {
    const res = await postEmailSignIn(buildConfig(rejectingSend(new EmailSignInError('boom'))));
    const location = new URL(res.headers.get('location')!);
    expect(location.pathname).toBe('/api/auth/signin');
  });

  it('a successful send still redirects to verify-request, unaffected', async () => {
    const res = await postEmailSignIn(buildConfig(async () => {}));
    const location = new URL(res.headers.get('location')!);
    expect(location.pathname).toBe('/api/auth/verify-request');
  });

  it('an uncaught ApiError (e.g. the rate-limit throw) ALSO routes to the generic /error page — not the "standard EmailSignin error redirect" auth-email-limit.ts\'s own comment claims', async () => {
    const res = await postEmailSignIn(
      buildConfig(rejectingSend(new ApiError('RATE_LIMITED', 'too many sign-in emails'))),
    );
    const location = new URL(res.headers.get('location')!);
    expect(location.pathname).toBe('/api/auth/error');
    expect(location.searchParams.get('error')).toBe('Configuration');
  });
});
