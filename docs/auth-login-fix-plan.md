# Auth/login fix plan (WS25)

## 0. Why this exists

Real sign-in is currently non-functional for every provider in any environment where
`AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET`/`RESEND_API_KEY`/`EMAIL_FROM` aren't set (which
includes this sandbox, and — as far as this plan's investigation could tell — production,
since no task in the original §19 WBS or the journeys-plan WBS ever wires real Resend
delivery into the sign-in flow specifically). Investigated live against a running
`next dev` instance plus a direct read of `auth.ts`, `lib/auth-providers.ts`, and
`apps/worker/src/lib/email-transport.ts`.

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
`done` in the workstream-lock registry, phase `P1`) built
`apps/worker/src/lib/email-transport.ts` — a real `ResendEmailTransport` /
`LoggingEmailTransport` / `defaultEmailTransport()` — but that file's own header says
outright: *"the auth email flow itself isn't touched here — out of scope, see PR notes."*
The design doc's own §19 WBS row for WS9-T1 (`receipts-design-doc.md:1459`) confirms its
scope was "notifications table flow, `notify:dispatch`, Resend templates, prefs +
List-Unsubscribe" — the product notification system, not sign-in. No task anywhere in
§19 or the journeys-plan (`docs/journeys-plan.md`, WS16–WS24) ever wires Resend into
`auth.ts`. This plan is that missing task.

`.env.example` (repo root) already documents `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET`/
`RESEND_API_KEY`/`EMAIL_FROM` as expected secrets — provisioning real values in a given
deployment is out of this plan's scope (nobody here holds those credentials); this plan
only fixes the code so that (a) an unconfigured Google button never renders instead of
breaking, and (b) email sign-in actually sends through Resend once `RESEND_API_KEY` is
provisioned, with a graceful failure path if it isn't or if the send itself fails.

## Revision note

This plan originally proposed task IDs `WS24-T1..T5` and extracting the email transport
to `packages/core/src/server`. An independent review caught two problems, both addressed
below: `WS16`–`WS24` is already fully allocated to `docs/journeys-plan.md` (`WS24-T1`
specifically already exists, `done`, as the Departures-board pilot — the ID collision
would have silently dropped this plan's real WS24-T1 during `add-tasks` and left WS24-T5
pointing at the wrong, unrelated task), so this plan now uses the next-free range,
`WS25-T1..T5`, under its own phase namespace (`A0`, matching how `journeys-plan.md` uses
`J0..JQ` and `swipe-ux-plan.md` uses `SP1..SPQ` rather than reusing the closed, historical
`P0` "48-hour build" wave). And the `packages/core` extraction turned out not to be the
"pure move, zero behavior change" it was described as — `email-transport.ts` imports
`apps/worker`'s own pino logger (a new dependency `packages/core` doesn't have), the
`@receipts/core/server` subpath is a single flat barrel file
(`packages/core/src/server.ts`) not a directory, `apps/worker`'s test imports the file by
its current path directly, and any `packages/core` change needs a `contract-change`-
labeled PR with a design-doc §4.2 amendment in the same PR (`receipts-design-doc.md:26`)
— none of which this bug-fix plan needs to take on. WS25-T2 now duplicates the ~90-line
transport into `apps/web/lib/` (swapping in `apps/web/lib/logger.ts`, which already
exists) instead.

## 1. Design

- **WS25-T1** gates Google's exposure exactly like X already is — smallest possible fix,
  ships independently, makes the broken button disappear immediately in any
  under-configured environment (including this one) without waiting on the rest of this
  plan.
- **WS25-T2** duplicates the existing, already-tested `EmailTransport` /
  `ResendEmailTransport` / `LoggingEmailTransport` / `defaultEmailTransport()` from
  `apps/worker/src/lib/email-transport.ts` into a new `apps/web/lib/email-transport.ts`,
  swapping the pino logger import for `apps/web/lib/logger.ts` (same pino setup, just the
  web app's own instance — no new dependency, no `packages/core` contract-change
  process). `apps/worker`'s copy is untouched; the two files knowingly diverge only in
  their logger import, and this plan's task note says so explicitly rather than
  papering over it as a "shared" module.
- **WS25-T3** is the actual fix for Bug B: `auth.ts`'s `sendVerificationRequest` calls
  the new local transport instead of throwing. `apps/web/lib/magic-link-mailbox.ts`'s
  `recordMagicLink`/`getLastMagicLink`/`clearMagicLinkMailbox` are retired (grepped: only
  `auth.ts` calls `recordMagicLink`, nothing calls `getLastMagicLink`/
  `clearMagicLinkMailbox` today — this is dead-code removal, not an API change anything
  depends on) in favor of the transport's own `LoggingEmailTransport`, which already
  covers the same "no real provider configured → keep an in-memory record" need.
- **WS25-T4** closes the failure-mode gap: confirm (empirically, via a real integration
  test — the existing code comment's claim that a thrown error "surfaces as Auth.js's
  normal EmailSignin error redirect" has not actually been verified by any test) how
  Auth.js needs an error shaped in order to redirect gracefully instead of hitting the
  generic Configuration page, and make a Resend send failure (bad API key, Resend down,
  network error) use that shape.
- **WS25-T5** is regression coverage tying the above together end-to-end, and confirms
  `apps/web/e2e/auth-provider-config.spec.ts` (an existing, on-topic test that already
  exercises real `auth()` under production `next start` for a different bug) stays green
  through T3/T4's edits to `buildProviders()`/`sendVerificationRequest`.

Sequencing: T1 has no dependencies and should ship first/independently. T2 → T3 → T4 are
a strict chain (each needs the previous). T5 depends on T1, T3, and T4 (needs the real
behavior of all three to test against).

## 2. Tasks

| ID | Title | Phase | Depends | AC |
|---|---|---|---|---|
| WS25-T1 | Gate the Google sign-in provider on env-presence, matching the existing X/Twitter pattern | A0 | — | `getEnabledAuthProviders()` excludes `'google'` unless both `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` are set; `auth.ts`'s `buildProviders()` applies the identical gate so the server-side provider list matches what the claim UI advertises (no button the server can't complete); unit tests cover all four configured/unconfigured combinations of google×x; `'email'` stays unconditionally enabled (unaffected). |
| WS25-T2 | Duplicate the Resend email transport into `apps/web/lib/email-transport.ts` | A0 | — | New `apps/web/lib/email-transport.ts` carries `EmailTransport`/`ResendEmailTransport`/`LoggingEmailTransport`/`defaultEmailTransport`, ported from `apps/worker/src/lib/email-transport.ts` with only the logger import swapped to `apps/web/lib/logger.ts`; `apps/worker`'s copy and its own test (`apps/worker/test/email-transport.test.ts`) are untouched; the new web-side copy gets its own unit tests (send success, missing-`RESEND_API_KEY` stub selection, missing-`EMAIL_FROM`-while-key-set throw) mirroring the worker copy's existing coverage; no `packages/core` files touched, no `contract-change` label needed. |
| WS25-T3 | Wire real Resend delivery into `auth.ts`'s `sendVerificationRequest`; remove the unconditional production throw | A0 | WS25-T2 | `sendVerificationRequest` calls `defaultEmailTransport().send(...)` (from WS25-T2) with a real magic-link template (subject/html/text, following `lib/copy.ts`'s existing brand-voice conventions and `apps/worker/src/lib/notification-email-template.ts`'s existing template style) in every environment — no more `NODE_ENV` branch, since the transport itself already degrades to a logging stub when `RESEND_API_KEY` is unset; `apps/web/lib/magic-link-mailbox.ts` and its `recordMagicLink` call site are removed (confirmed dead once this lands — nothing else calls `getLastMagicLink`/`clearMagicLinkMailbox` today); the stale "WS9 scope" comment is corrected to describe what's actually wired; `enforceAuthEmailSendLimit` still runs before any send attempt, unchanged. |
| WS25-T4 | Make a Resend send failure degrade gracefully instead of hitting Auth.js's generic Configuration error page | A0 | WS25-T3 | Empirically confirm (new test, not just re-trusting the existing rate-limit comment) what error shape/class Auth.js needs thrown from inside `sendVerificationRequest` to redirect to its normal `EmailSignin`-error state rather than the generic `Configuration` page; a `ResendEmailTransport` send failure (mocked non-2xx/network error) and a missing-`EMAIL_FROM`-while-`RESEND_API_KEY`-set misconfiguration both use that shape; a user hitting either case lands on a page that says sign-in failed and invites a retry, never the raw "Server error / check the server logs" page. |
| WS25-T5 | Regression coverage for the full sign-in path (provider gating + transport selection + send success/failure) | A0 | WS25-T1, WS25-T3, WS25-T4 | Unit tests: all four provider-gating combinations (already listed under T1, consolidated here if not already merged); transport selection (stub vs. real) by env; a mocked successful Resend send. Integration/e2e: a production-mode (`next start`, `NODE_ENV=production`) run of the email sign-in step against a mocked Resend endpoint reaches `/api/auth/verify-request` on success and the graceful failure state (from T4) on a forced send failure — this is the first test in the repo to actually exercise the production email branch at all (today only the dev-mode stub path is tested, per `golden-loop.spec.ts`'s own header comment on why it bypasses real sign-in). `apps/web/e2e/auth-provider-config.spec.ts` (existing, unrelated bug it guards against) is confirmed still green. |

## 3. Explicitly out of scope

- Provisioning real `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET`/`RESEND_API_KEY`/`EMAIL_FROM`
  values in any environment (sandbox, staging, or production) — that's deployment
  configuration, not a code change, and nobody working this plan holds those credentials.
- Wiring up X/Twitter for real (it's already correctly gated off when unconfigured, so it
  has no user-facing bug — only Google and email do).
- Extracting the email transport to a shared `packages/core` (or any other shared
  package) location — deliberately deferred; see "Revision note" above. A future task
  can revisit this once there's a second real web-side consumer to justify the
  contract-change overhead.
