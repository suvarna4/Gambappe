/**
 * Auth.js v5 configuration (design doc §11.1–11.2, WS2-T2).
 *
 * Providers: Email magic link (TTL `MAGIC_LINK_TTL_MIN`, always enabled), Google OAuth and
 * X/Twitter OAuth (each included only when its own `AUTH_<PROVIDER>_ID`/`_SECRET` pair is
 * configured — an env-presence gate rather than a formal `core/flags.ts` entry, per the task
 * brief: minimal, no shared-file churn; WS25-T1 extended this gate to Google, which originally
 * shipped unconditional — see `buildProviders()`). Database sessions (not JWT) via the Drizzle
 * adapter against the existing
 * `users`/`accounts`/`sessions`/`verification_tokens` tables (`packages/db/src/schema/identity.ts`).
 * `allowDangerousEmailAccountLinking: false` — verified-email linking only (§11.1).
 *
 * Magic-link delivery (WS25-T3) goes through `@receipts/core/server`'s shared `EmailTransport`
 * (originally WS9-T1's `apps/worker` implementation, extracted to `packages/core` by WS25-T2) —
 * see `sendVerificationRequest` below. That transport already degrades to a non-production
 * logging stub when `RESEND_API_KEY` is unset, so this file no longer needs its own
 * `NODE_ENV`-branched stub/throw.
 *
 * WS25-T4: any failure inside `sendVerificationRequest` (rate limit, transport/misconfiguration)
 * is caught and re-thrown as `EmailSignInError` — see `apps/web/lib/auth-magic-link-send.ts`
 * (WS25-T5 extracted the handler body there so it's directly testable under vitest, since this
 * file itself can't be — see that file's own header) and
 * `apps/web/test/auth-error-routing.test.ts` for why: an error that ISN'T an `@auth/core`
 * `AuthError` subclass makes Auth.js's own top-level catch block (`@auth/core`'s `Auth()`)
 * default to its generic `/api/auth/error?error=Configuration` page — the exact page this whole
 * WS25 effort exists to get users off of. `EmailSignInError`'s `kind: "signIn"` instead routes
 * back to the sign-in page, a graceful, retry-inviting result instead of a dead end.
 *
 * Config is built via NextAuth's "lazy initialization" form (a function, not a plain object) —
 * this defers `getDb()` (and therefore requiring `DATABASE_URL`) until the first actual
 * request. `next build`'s page-data-collection step imports/evaluates this module without
 * ever handling a request, so an eager `DrizzleAdapter(getDb(), ...)` at module scope would
 * make `DATABASE_URL` a *build-time* requirement, not just a runtime one — this form avoids that.
 */
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import type { Adapter } from 'next-auth/adapters';
import NextAuth from 'next-auth';
import type { NextAuthConfig } from 'next-auth';
import Google from 'next-auth/providers/google';
import Nodemailer from 'next-auth/providers/nodemailer';
import Twitter from 'next-auth/providers/twitter';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { MAGIC_LINK_TTL_MIN } from '@receipts/core';
import { accounts, sessions, users, verificationTokens } from '@receipts/db';
import { getDb } from './lib/stores';
import { sendMagicLinkEmail } from './lib/auth-magic-link-send';
import { sessionCookieConfig, SESSION_MAX_AGE_S } from './lib/auth-cookies';

/**
 * `DrizzleAdapter`'s generic dialect parameter (Postgres/MySQL/SQLite) can't be inferred
 * cleanly through the doubly-cast schema object below, so it's pinned explicitly to the
 * Postgres arm here — this is purely a compile-time anchor, not a runtime behavior change.
 */
type AnyPgDatabase = PgDatabase<PgQueryResultHKT, Record<string, unknown>>;

function buildAdapter(): Adapter {
  /**
   * `@auth/drizzle-adapter`'s Postgres table types assume the generic OAuth-profile default
   * shape (`name`, `image` columns on `users`). Ours intentionally omits both — INV-4: no
   * name, phone, or address columns anywhere in the schema. The adapter's runtime code only
   * reads/writes columns that actually exist on the table object it's given (unknown keys
   * passed to Drizzle's `.values()` are dropped, not persisted), so this is a safe structural
   * cast, not a real type hole. `DefaultPostgresSchema` itself isn't part of the package's
   * public export map, so the schema argument is cast via `any` rather than that unreachable
   * type name.
   */
  return DrizzleAdapter<AnyPgDatabase>(getDb() as unknown as AnyPgDatabase, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see comment above
  } as any);
}

function buildProviders(): NextAuthConfig['providers'] {
  const providers: NextAuthConfig['providers'] = [
    Nodemailer({
      id: 'email',
      name: 'Email',
      // `@auth/core`'s Nodemailer provider throws synchronously — unconditionally, on every
      // `auth()` call, since this factory re-runs per request — if `server` is falsy, even
      // though `sendVerificationRequest` is fully overridden below and never reads
      // `provider.server` (it only calls `createTransport(provider.server)` in the library's
      // own default implementation, which we never reach). This placeholder is provably never
      // used to connect anywhere; its only job is to satisfy that falsy-check. A bug WS2-T2
      // shipped unnoticed since nothing before exercised `auth()` from a live route/page (every
      // existing integration test calls lib functions directly, bypassing the route layer).
      server: { host: 'localhost', port: 25, auth: { user: '', pass: '' } },
      from: process.env.EMAIL_FROM ?? 'noreply@receipts.example',
      maxAge: MAGIC_LINK_TTL_MIN * 60,
      // WS25-T5: the actual handler body lives in `./lib/auth-magic-link-send.ts` (rate limit,
      // shared-transport send, WS25-T4's error wrapping) — extracted so it's directly testable
      // under vitest without importing `next-auth` itself. This is a thin pass-through.
      sendVerificationRequest: ({ identifier, url, request }) =>
        sendMagicLinkEmail(identifier, url, request.headers),
    }),
  ];

  // WS25-T1 (design-diff audit): Google used to be pushed unconditionally above, regardless of
  // whether AUTH_GOOGLE_ID/AUTH_GOOGLE_SECRET were configured — next-auth's Google provider
  // doesn't validate their presence itself, it just builds an OAuth authorize URL with
  // `client_id=undefined`, which Google's server rejects and Auth.js surfaces as its generic
  // `/api/auth/error?error=Configuration` page. Now gated the same way X already was, so the
  // server-side provider list matches what `getEnabledAuthProviders()` advertises to the UI
  // (`apps/web/lib/auth-providers.ts`) — no provider is ever registered that the claim UI
  // wouldn't also offer, and vice versa.
  if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) {
    // §11.1: verified-email linking only — explicit even though it's also the library default.
    providers.push(Google({ allowDangerousEmailAccountLinking: false }));
  }

  if (process.env.AUTH_TWITTER_ID && process.env.AUTH_TWITTER_SECRET) {
    // X provides no reliable verified-email claim (§11.1) — X-only accounts stand alone unless
    // the same email is separately verified via magic link first; still off for linking here.
    providers.push(Twitter({ allowDangerousEmailAccountLinking: false }));
  }

  return providers;
}

export const { handlers, auth, signIn, signOut } = NextAuth(() => {
  const useSecureCookies = process.env.NODE_ENV === 'production';
  const { name: sessionCookieName, options: sessionCookieOptions } =
    sessionCookieConfig(useSecureCookies);

  return {
    adapter: buildAdapter(),
    providers: buildProviders(),
    session: { strategy: 'database', maxAge: SESSION_MAX_AGE_S, updateAge: 24 * 60 * 60 },
    useSecureCookies,
    cookies: {
      sessionToken: { name: sessionCookieName, options: sessionCookieOptions },
    },
    // Design-diff follow-up to WS25: without this, ANY sign-in failure that reaches Auth.js's
    // top-level error routing lands on an Auth.js-owned page instead of this app's UI — the same
    // class of bug WS25 fixed on the send side, just on the verify side. Both keys are required,
    // not just `error`: Auth.js's own `Auth()` (`@auth/core`) picks the redirect destination from
    // the THROWN ERROR'S OWN `kind` (`(isAuthError && error.kind) || "error"`) — `Verification`
    // (an expired/already-used magic-link token) has `kind: "error"` and only `pages.error`
    // catches it, but `EmailSignInError` (WS25-T4's rate-limit/transport-failure wrapper) and
    // every OAuth callback error class extend `SignInError`, whose `kind` is `"signIn"` — those
    // fall through to Auth.js's own default `/api/auth/signin` unless `pages.signIn` is ALSO set.
    // Both point at `/claim`, which reads `?error=...` (`ClaimEntry`'s `authError` prop) and
    // shows a clear, on-brand retry message regardless of which kind sent it there.
    pages: { error: '/claim', signIn: '/claim' },
    experimental: { enableWebAuthn: false },
    trustHost: true,
    callbacks: {
      async signIn({ account, profile }) {
        // Verified-email linking only (§11.1) — Google emails are verified; X provides none
        // reliably, so X accounts stand alone unless the same email is verified via magic
        // link first (handled by `allowDangerousEmailAccountLinking: false` on each provider).
        // Fail closed: an absent/undefined claim is treated the same as an explicit `false`,
        // not silently allowed through — `!== true`, not `=== false`.
        if (account?.provider === 'google' && profile?.['email_verified'] !== true) {
          return false;
        }
        return true;
      },
    },
  };
});
