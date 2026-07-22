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
 * is caught and re-thrown as `EmailSignInError` — see that handler's own comment and
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
import { EmailSignInError } from '@auth/core/errors';
import { MAGIC_LINK_TTL_MIN } from '@receipts/core';
import { defaultEmailTransport } from '@receipts/core/server';
import { accounts, sessions, users, verificationTokens } from '@receipts/db';
import { getDb } from './lib/stores';
import { enforceAuthEmailSendLimit } from './lib/auth-email-limit';
import { sessionCookieConfig, SESSION_MAX_AGE_S } from './lib/auth-cookies';
import { renderMagicLinkEmail } from './lib/auth-email-template';
import { logger } from './lib/logger';

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
      async sendVerificationRequest({ identifier, url, request }) {
        // WS25-T4: everything below is wrapped in one try/catch — §14.1's rate limit, the
        // transport's own misconfiguration throw (missing EMAIL_FROM), and a real Resend send
        // failure are all `sendVerificationRequest`-internal failures with the identical
        // underlying problem: an error that isn't an `@auth/core` `AuthError` subclass makes
        // Auth.js default to its generic `/api/auth/error?error=Configuration` page (empirically
        // confirmed, not assumed — `apps/web/test/auth-error-routing.test.ts` — this file's OWN
        // prior comment here claimed the rate-limit throw already got "Auth.js's normal
        // EmailSignin error redirect," which that test proves false: a plain `ApiError` routes
        // to the generic page exactly like an unwrapped transport failure does). One catch
        // normalizes all three into the same graceful, retry-inviting redirect.
        try {
          // §14.1 "Auth email sends | email+IP | 5/hour" (audit 2.4), enforced BEFORE any
          // dispatch. Runs strictly at send time inside this handler — nothing here executes
          // during `next build`'s module evaluation (see the lazy-init note in this file's
          // header).
          await enforceAuthEmailSendLimit(identifier, request.headers);

          // WS25-T3: real send via the shared transport (§13.2, `@receipts/core/server`). No
          // `NODE_ENV` branch here — `defaultEmailTransport()` already selects the real Resend
          // transport when `RESEND_API_KEY` is set and a non-production logging stub otherwise
          // (never logs `identifier`/the recipient email itself, §16.2), so this call is
          // identical in every environment; only the transport underneath it differs. Also
          // covers `defaultEmailTransport()`'s own synchronous throw when `RESEND_API_KEY` is
          // set but `EMAIL_FROM` is missing — that call is inside this same try block.
          const { subject, html, text } = renderMagicLinkEmail(url, MAGIC_LINK_TTL_MIN);
          await defaultEmailTransport(logger).send({ to: identifier, subject, html, text });
        } catch (err) {
          // Never logs `identifier`/the recipient email (§16.2) — only the failure itself.
          const message = err instanceof Error ? err.message : String(err);
          logger.error({ err: message }, 'sendVerificationRequest failed');
          // `AuthError`'s published .d.ts only declares the plain `Error(message, options)`
          // shape (its richer runtime constructor isn't reflected in the type declarations),
          // hence `{ cause: err }` rather than passing `err` itself as the first argument.
          throw new EmailSignInError(message, { cause: err });
        }
      },
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
