/**
 * Auth.js v5 configuration (design doc §11.1–11.2, WS2-T2).
 *
 * Providers: Email magic link (TTL `MAGIC_LINK_TTL_MIN`), Google OAuth, X/Twitter OAuth
 * (included only when `AUTH_TWITTER_ID`/`AUTH_TWITTER_SECRET` are configured — an env-presence
 * gate rather than a formal `core/flags.ts` entry, per the task brief: minimal, no shared-file
 * churn). Database sessions (not JWT) via the Drizzle adapter against the existing
 * `users`/`accounts`/`sessions`/`verification_tokens` tables (`packages/db/src/schema/identity.ts`).
 * `allowDangerousEmailAccountLinking: false` — verified-email linking only (§11.1).
 *
 * Real magic-link delivery (Resend) is WS9 scope; `sendVerificationRequest` below is the
 * pluggable stub called out in the WS2 task brief.
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
import { sessionCookieConfig, SESSION_MAX_AGE_S } from './lib/auth-cookies';
import { recordMagicLink } from './lib/magic-link-mailbox';

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
    // §11.1: verified-email linking only — explicit even though it's also the library default.
    Google({ allowDangerousEmailAccountLinking: false }),
    Nodemailer({
      id: 'email',
      name: 'Email',
      from: process.env.EMAIL_FROM ?? 'noreply@receipts.example',
      maxAge: MAGIC_LINK_TTL_MIN * 60,
      // The `Nodemailer()` provider factory throws at construction time ("Nodemailer requires
      // a `server` configuration") if `server` is omitted — it doesn't defer that check to
      // send time, so every call to `NextAuth(...)`'s lazy config function (i.e. every request
      // that touches `auth`/`signIn`/`handlers`, not just an actual email sign-in) crashed
      // without this, a bug WS2-T2 shipped unnoticed since nothing before WS7-T5 exercised
      // `auth()` from a live route/page (every existing integration test calls lib functions
      // directly, bypassing the route layer). This placeholder transport is never actually
      // used to send mail: `sendVerificationRequest` below is fully overridden and returns
      // (dev/test) or throws (prod) before ever reaching the real `createTransport(server)`
      // call inside the library's default implementation.
      server: { host: 'localhost', port: 25 },
      async sendVerificationRequest({ identifier, url }) {
        // WS2-T2 stub: real Resend sending is WS9 scope (§13.2). Outside production, store the
        // link in the in-memory mailbox so test harnesses and local dev can read it back
        // without a mail provider — never logged (§16.2 forbids logging emails unconditionally,
        // not just in production; `getLastMagicLink` is the intended read-back path).
        if (process.env.NODE_ENV !== 'production') {
          recordMagicLink(identifier, url);
          return;
        }
        throw new Error(
          'sendVerificationRequest: production email sending is not wired yet (WS9 scope)',
        );
      },
    }),
  ];

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
