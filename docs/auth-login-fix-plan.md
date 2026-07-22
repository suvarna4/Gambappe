# Auth/login fix plan (WS24)

## 0. Why this exists

Real sign-in is currently non-functional for every provider in any environment where
`AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET`/`RESEND_API_KEY`/`EMAIL_FROM` aren't set (which
includes this sandbox, and — as far as this plan's investigation could tell — production,
since no task in the original §19 WBS ever wires real Resend delivery into the sign-in
flow specifically). Investigated live against a running `next dev` instance plus a direct
read of `auth.ts`, `lib/auth-providers.ts`, and `apps/worker/src/lib/email-transport.ts`.

Two independent bugs, both reachable from `/claim`'s sign-in step
(`components/claim/ClaimEntry.tsx`):

**Bug A — Google button is shown even when unconfigured.** `getEnabledAuthProviders()`
(`apps/web/lib/auth-providers.ts`) hardcodes `'google'` into the enabled-providers array
unconditionally, and `auth.ts`'s `buildProviders()` unconditionally pushes
`Google({...})` too. Contrast the `'x'`/Twitter provider, which both functions correctly
gate on `AUTH_TWITTER_ID && AUTH_TWITTER_SECRET` being present — `getEnabledAuthProviders`'s
own doc comment says it "mirrors the same env-presence gate `auth.ts` uses for the
Twitter/X provider," but the code doesn't actually do that for Google. Confirmed via a
direct `POST /api/auth/signin/google` request against the running dev server: the
redirect `Location` header is
`https://accounts.google.com/o/oauth2/v2/auth?...&client_id=undefined&...` — proof the
button is live and broken, not just theoretically unconfigured.

**Bug B — Email magic-link sign-in throws unconditionally in production.**
`auth.ts`'s `sendVerificationRequest`:

```ts
if (process.env.NODE_ENV !== 'production') {
  recordMagicLink(identifier, url);
  return;
}
throw new Error(
  'sendVerificationRequest: production email sending is not wired yet (WS9 scope)',
);
```

The `NODE_ENV !== 'production'` branch is why this looked fine when tested locally
against `next dev` (`NODE_ENV=development`) — every local/dev attempt takes the stub path
and succeeds. In production the function always throws, and Auth.js has no special
handling for an arbitrary thrown `Error` here, so it surfaces as its generic
`/api/auth/error?error=Configuration` page ("Server error — There is a problem with the
server configuration. Check the server logs for more information.") for every real user,
every time.

The comment's "WS9 scope" pointer is stale. `WS9-T1` ("Outbox + email channel," confirmed
`done` in the workstream-lock registry) built `apps/worker/src/lib/email-transport.ts` —
a real `ResendEmailTransport` / `LoggingEmailTransport` / `defaultEmailTransport()` — but
that file's own header says outright: *"the auth email flow itself isn't touched here —
out of scope, see PR notes."* The design doc's own §19 WBS row for WS9-T1 confirms its
scope was "notifications table flow, `notify:dispatch`, Resend templates, prefs +
List-Unsubscribe" — the product notification system, not sign-in. No task anywhere in
§19 ever wires Resend into `auth.ts`. This plan is that missing task.

`.env.example` (repo root) already documents `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET`/
`RESEND_API_KEY`/`EMAIL_FROM` as expected secrets — provisioning real values in a given
deployment is out of this plan's scope (nobody here holds those credentials); this plan
only fixes the code so that (a) an unconfigured Google button never renders instead of
breaking, and (b) email sign-in actually sends through Resend once `RESEND_API_KEY` is
provisioned, with a graceful failure path if it isn't or if the send itself fails.

## 1. Design

- **WS24-T1** gates Google's exposure exactly like X already is — smallest possible fix,
  ships independently, makes the broken button disappear immediately in any
  under-configured environment (including this one) without waiting on the rest of this
  plan.
- **WS24-T2** moves the existing, already-tested `EmailTransport` /
  `ResendEmailTransport` / `LoggingEmailTransport` / `defaultEmailTransport()` from
  `apps/worker/src/lib/email-transport.ts` into `packages/core/src/server/` (the
  established `@receipts/core/server` Node-only subpath — see design doc §"Two export
  surfaces, one package," already the documented home for exactly this kind of
  worker-and-web-shared, `node:`-dependent code) so `apps/web` can use the *same* Resend
  wiring `apps/worker` already ships, instead of forking a second copy. `apps/worker`
  switches its import to the shared path; behavior is unchanged there (this is a pure
  move + re-export, not a rewrite).
- **WS24-T3** is the actual fix for Bug B: `auth.ts`'s `sendVerificationRequest` calls the
  shared transport instead of throwing. Non-production behavior (the in-memory
  `recordMagicLink` stub) is unchanged — `defaultEmailTransport()` already degrades to a
  logging stub when `RESEND_API_KEY` is unset, so the two stubs need to be reconciled
  (see task note) rather than left running side by side.
- **WS24-T4** closes the failure-mode gap: confirm (empirically, via a real integration
  test — the existing code comment's claim that a thrown error "surfaces as Auth.js's
  normal EmailSignin error redirect" has not actually been verified by any test) how
  Auth.js needs an error shaped in order to redirect gracefully instead of hitting the
  generic Configuration page, and make a Resend send failure (bad API key, Resend down,
  network error) use that shape.
- **WS24-T5** is regression coverage tying the above together end-to-end.

Sequencing: T1 has no dependencies and should ship first/independently. T2 → T3 → T4 are
a strict chain (each needs the previous). T5 depends on T1, T3, and T4 (needs the real
behavior of all three to test against).

## 2. Tasks

| ID | Title | Phase | Depends | AC |
|---|---|---|---|---|
| WS24-T1 | Gate the Google sign-in provider on env-presence, matching the existing X/Twitter pattern | P0 | — | `getEnabledAuthProviders()` excludes `'google'` unless both `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` are set; `auth.ts`'s `buildProviders()` applies the identical gate so the server-side provider list matches what the claim UI advertises (no button the server can't complete); unit tests cover all four configured/unconfigured combinations of google×x; `'email'` stays unconditionally enabled (unaffected). |
| WS24-T2 | Extract the Resend email transport to `packages/core/src/server` for reuse by `apps/web` | P0 | — | `EmailTransport`/`ResendEmailTransport`/`LoggingEmailTransport`/`defaultEmailTransport` move to `packages/core/src/server/email-transport.ts`, exported only via the existing `@receipts/core/server` subpath (never the main barrel — must stay unreachable from a client bundle, per the design doc's own constraint on that subpath); `apps/worker`'s existing usage is updated to the new import path with zero behavior change (its existing tests pass unmodified); the moved module's own existing tests move with it. |
| WS24-T3 | Wire real Resend delivery into `auth.ts`'s `sendVerificationRequest`; remove the unconditional production throw | P0 | WS24-T2 | Production calls `defaultEmailTransport().send(...)` with a real magic-link template (subject/html/text, following `lib/copy.ts`'s existing brand-voice conventions and `apps/worker/src/lib/notification-email-template.ts`'s existing template style) instead of throwing; when `RESEND_API_KEY` is unset, behavior is the transport's own `LoggingEmailTransport` stub — reconciled with (replacing, not running alongside) the existing dev-only `recordMagicLink`/`magic-link-mailbox.ts` stub so there is exactly one non-production code path, not two; the stale "WS9 scope" comment is corrected to describe what's actually wired; the rate-limit check (`enforceAuthEmailSendLimit`) still runs before any send attempt, unchanged. |
| WS24-T4 | Make a Resend send failure degrade gracefully instead of hitting Auth.js's generic Configuration error page | P0 | WS24-T3 | Empirically confirm (new test, not just re-trusting the existing rate-limit comment) what error shape/class Auth.js needs thrown from inside `sendVerificationRequest` to redirect to its normal `EmailSignin`-error state rather than the generic `Configuration` page; a `ResendEmailTransport` send failure (mocked non-2xx/network error) and a missing-`EMAIL_FROM`-while-`RESEND_API_KEY`-set misconfiguration both use that shape; a user hitting either case lands on a page that says sign-in failed and invites a retry, never the raw "Server error / check the server logs" page. |
| WS24-T5 | Regression coverage for the full sign-in path (provider gating + transport selection + send success/failure) | P0 | WS24-T1, WS24-T3, WS24-T4 | Unit tests: all four provider-gating combinations (already listed under T1, consolidated here if not already merged); transport selection (stub vs. real) by env; a mocked successful Resend send. Integration/e2e: a production-mode-equivalent run of the email sign-in step against a mocked Resend endpoint reaches `/api/auth/verify-request` on success and the graceful failure state (from T4) on a forced send failure — this is the first test in the repo to actually exercise the production email branch at all (today only the dev-mode stub path via `seedClaimSession`-style bypasses is tested anywhere, per `golden-loop.spec.ts`'s own header comment). |

## 3. Explicitly out of scope

- Provisioning real `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET`/`RESEND_API_KEY`/`EMAIL_FROM`
  values in any environment (sandbox, staging, or production) — that's deployment
  configuration, not a code change, and nobody working this plan holds those credentials.
- Wiring up X/Twitter for real (it's already correctly gated off when unconfigured, so it
  has no user-facing bug — only Google and email do).
- Anything about `packages/core/src/server`'s existing contents beyond adding this one
  new module — no refactor of what's already there.
