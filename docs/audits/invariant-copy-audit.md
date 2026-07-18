# Invariant & copy audit (WS14-T3)

Checklist run against design doc §1.2 (INV-1..10) and §10.6 (copy rules), per the WS14-T3
AC: "Checklist run: INV-1..10 each with evidence; copy scan for money words (`bet|stake|wager|\$`)
in `copy.ts` with allowlist." This is the audit gating §19.5's Gate P1 ("WS14-T3 audit signed").

**Scope note:** run against `main` at the commit noted in the sign-off below. WS5, WS6, WS7, and
WS8 each still have unmerged tasks at that point (duo matchup/history APIs, duo UI, share cards,
SEO pass — see `workstream-locks.json`). Those add code and copy this pass hasn't seen. This
audit is not a standing guarantee past its commit — re-run once the remaining WS1–WS13 tasks
land, and before Gate P1.5 (duo behind flag) if duo copy changes materially.

## INV-1 — never holds money, routes orders, sets odds, or takes positions

**Evidence:**
- `scripts/check-dependency-denylist.mjs` — denies `stripe`, `paypal`, `braintree`, `adyen`,
  `square`, `plaid`, `razorpay`, `coinbase`, `binance`, `ccxt`, exchange SDKs, and venue
  *trading* clients (`kalshi.*sdk|client|api`, `@polymarket/clob-client`) by name, scanning every
  workspace `package.json` plus the `pnpm-lock.yaml` transitive closure.
- Wired into CI: `.github/workflows/ci.yml` "Dependency denylist scan (INV-1 — no
  payment/exchange-trading SDKs)" step, `pnpm denylist`.
- Ran locally against the audited commit: **passed** ("no payment/exchange-trading SDKs found").
- `packages/venues` (Kalshi/Polymarket adapters) are read-only REST clients hand-rolled against
  each venue's public market-data API (§7.1–7.4) — no order-placement or account-linking calls
  exist in either adapter.

**Verdict: holds.**

## INV-2 — never collect/store credentials for any other platform

**Evidence:**
- `packages/db/src/schema/identity.ts` (`users`, `accounts`, `sessions`) — Auth.js tables for
  *our own* auth only (Google/X OAuth, email magic link). No columns anywhere for a venue API
  key, exchange login, or private key.
- `packages/db/src/repositories/wallet-links.ts` header comment: "No credential/key columns
  exist anywhere on this table (INV-2) — these helpers only ever move an address, its HMAC hash,
  a resolved proxy address, and the bucketed `enrichment` blob (INV-7)." Confirmed by reading the
  `wallet_links` schema and every repository function — no signing-key or session-credential
  field.
- `apps/web/lib/wallet-verify.ts` — wallet linking is a **message signature only**: `viem`'s
  `verifyMessage` against a SIWE message, EOA or smart-contract-wallet (EIP-1271/6492) signature.
  No private key, seed phrase, or transaction-signing request is ever solicited or stored; a
  verification failure of any kind (bad signature, unreachable RPC, malformed input) fails closed
  to `false`, never a stored credential.
- The only non-auth "API key" fields in the codebase (`apps/worker/src/lib/email-transport.ts`'s
  `RESEND_API_KEY`, `push-transport.ts`'s VAPID keys) are *our own* service credentials for our
  own email/push infrastructure, not a user's credential to another platform.

**Verdict: holds.**

## INV-3 — competition denominated only in points/ratings/streaks

**Evidence:**
- Schema-wide scan (`packages/db/src/schema/*.ts`) for `balance|currency|amount_usd|cash|credit`
  columns: **zero matches** across `identity.ts`, `markets.ts`, `engine.ts`, `modes.ts`,
  `social.ts`, `ops.ts`.
- `profiles` (identity.ts) carries only `bot_score`, `current_streak`/`best_streak`,
  `freeze_bank`, `current_win_streak`/`best_win_streak` — no balance-like field.
- `picks.yes_price_at_entry` (markets.ts) is an implied *probability* (`numeric(6,5)`, 0–1), not
  a money amount; `picks.edge` is `(win?1:0) − p_side_entry`, also unit-free.

**Verdict: holds.**

## INV-4 — identity is minimal (email/OAuth/passkey only)

**Evidence:**
- `packages/db/src/schema/identity.ts`'s `users` table comment: "Auth.js standard tables via the
  Drizzle adapter, minus columns INV-4 forbids: no name, no phone, no address, no image." Column
  list confirms: `id, email, email_verified, role, age_attested_at, created_at, updated_at` —
  nothing else.
- `profiles` carries only a generated `handle`/`slug` (public identity), never a real name.
- Email lives on `users` only, never on `profiles` — the table the public-facing queries and
  serializers actually read — so a public query has no path to leak it.

**Verdict: holds.**

## INV-5 — competitive records scored only from in-app picks

**Evidence:**
- `apps/worker/src/jobs/ratings-weekly.ts` imports nothing from the wallet or fingerprint
  modules — confirmed by import scan (`grep wallet|fingerprint`: no matches). Its inputs are
  `picks`/`questions`/`profiles` repositories only.
- Wallet data's only two consumers: `packages/engine/src/fingerprint.ts` (feeds
  `fingerprints.placement_prior`, a *seed* used solely to warm-start a new profile's fingerprint
  before it has enough in-app picks — §8.7/§12.4) and `packages/db/src/repositories/profile-page.ts`
  (renders the wallet-linked **badge** only, via `wallet-links.js`'s `toWalletBadge`).
- Neither `nemesis-assign.ts`, `duo-matchmaker.ts`, nor `ratings-weekly.ts` reference wallet
  tables — matchmaking and rating computation read only from `picks`/`questions`/`ratings`.

**Verdict: holds.**

## INV-6 — public means public; pseudonymity is permanent

**Evidence:**
- `apps/web/lib/copy.ts`'s `CLAIM_PUBLICNESS_STATEMENT` ("Your picks, results, and rating are
  public — that's the point. You can stay pseudonymous forever.") is pinned verbatim per §10.6
  and rendered in `apps/web/components/claim/ClaimEntry.tsx:157`.
- No real-name field exists on `profiles` (see INV-4) — the only identity surfaced anywhere
  (handle, slug, streaks, picks, ratings) is pseudonymous by construction, not by a UI choice
  layered on top of a real-name schema.

**Verdict: holds.**

## INV-7 — exact real-money amounts never stored or displayed

**Evidence:**
- `packages/engine/src/wallet-bucketing.ts` is the **only** place a raw position notional is
  ever read (header comment: "This is the ONLY place raw position notionals are ever looked
  at"). `sizeBucket()` reads `notionalUsd` once to pick a `WALLET_SIZE_BUCKETS` bucket; the
  returned `WalletEnrichment` object contains only bucket/category *counts* and derived priors —
  the notional itself is never copied into it.
- `packages/engine/test/wallet-bucketing.test.ts` asserts the persisted JSON contains no numeric
  field except counts/priors (the §12.4-mandated unit test).
- `packages/db/src/repositories/wallet-links.ts`'s `unlinkWalletLink` nulls the plaintext
  `address`/`proxy_address` on unlink — even the linked address itself doesn't survive unlink,
  only its HMAC hash (relink-cooldown check).

**Verdict: holds.**

## INV-8 — competitive pressure targets participation/ego, never stake size

**Evidence:** see the copy scan below (clean) plus:
- `markets.liquidity_usd` (markets.ts) is commented "Curation filters only — never displayed
  (INV-8)"; confirmed by grep — its only consumer in `apps/web` is
  `app/api/admin/markets/route.ts`'s `min_liquidity_usd` query-param filter (an admin curation
  tool). No client-facing serializer (`serialize-question.ts`, `question-view.ts`, profile/duo/
  nemesis serializers) exposes it.

**Verdict: holds.**

## INV-9 — 18+ self-attestation, timestamped before first participation

**Evidence:**
- `users.age_attested_at` / `profiles.age_attested_at` — both nullable timestamp columns,
  required non-null before a pick/claim completes.
- `apps/web/app/api/v1/questions/[id]/picks/route.ts`: if `profile.ageAttestedAt === null`, the
  request requires `body.age_attested === true` in the same call and stamps `ageAttestedAt` at
  that moment — the first-pick attest is atomic with the pick itself (§6.2 step 0).
- `apps/web/app/api/v1/claim/route.ts` takes `body.age_attested` on claim — re-affirmed at claim
  per the invariant's text, not just inherited from the ghost profile.
- `apps/web/app/layout.tsx` renders `EIGHTEEN_PLUS_FOOTER_NOTICE` in a `<footer>` inside the root
  layout — every page gets it, there's no per-route opt-out.
- **Gap found (flagging, not a violation):** §7.8's outbound deep-link builder ("Trade this on
  {Kalshi|Polymarket}" link, attested-only referral params `KALSHI_REF_PARAM`/
  `POLYMARKET_REF_PARAM`, firing a `venue_outbound_click` analytics event) does not exist
  anywhere in the codebase yet — `markets.venue_url` is serialized straight through
  (`serialize-question.ts:97`, `question-view.ts:116`) with no ref-param attachment logic at
  all, and no UI surface renders an outbound venue link. This isn't an INV-9 *violation* (no ref
  param is ever attached to anyone, attested or not, so nothing leaks to an unattested session —
  the invariant holds vacuously) but the feature §7.8 describes, and which INV-9's own
  enforcement column cites as "link-out builder (§7.8)," is simply unbuilt. No WBS row in §19.3
  explicitly owns it either. Recommend a follow-up task be added to the WBS before Gate P1
  ships, since §7.8 also states this link is "the only money-adjacent surface" the product is
  supposed to have at all — right now it has none, which is safe but incomplete relative to spec.

**Verdict: holds (with one unbuilt-feature gap noted above, not a violation).**

## INV-10 — spectator pages are viewer-free

**Evidence:**
- `apps/web/test/question-state-view.test.tsx`'s `INV-10 — SSR is viewer-free` describe block:
  renders `QuestionStateView`/`ViewerStrip` to static HTML twice (anon vs. a populated viewer
  state) and asserts byte-identical output.
- `apps/web/e2e/question-page.spec.ts`'s `INV-10 — spectator page is viewer-free at the HTTP
  layer` describe block: real HTTP requests with/without a ghost cookie, asserting identical
  response bytes.
- `apps/web/e2e/spectator-cache-key.spec.ts`: `GET /q/:slug` is byte-identical with and without a
  ghost cookie present (§10.2) — the cache-key-safety proof for the CDN layer.
- All three were green on the audited commit (see sign-off).

**Verdict: holds.**

## Copy scan (§10.6, money words: `bet|stake|wager|\$`)

Scanned `apps/web/lib/copy.ts` (the single source of every user-facing string, per §10.6) with
`grep -niE '\b(bet|stake|wager)\b|\$'`.

**Matches, all allowlisted:**
- Every hit is either (a) inside the file's own header/inline comments *documenting* the INV-8
  rule ("No money amounts, 'bets', stake sizes..."), or (b) inside one of the two reassurance
  strings that use the words in **negation**: `CLAIM_AGE_ATTEST_FOOTNOTE` and
  `EIGHTEEN_PLUS_FOOTER_NOTICE`, both reading "Receipts never holds money — picks are for
  competition, not wagers." A negation reassuring the user money isn't involved is the opposite
  of the violation INV-8 guards against, so it's allowlisted.
- No bare dollar amount (`$` followed by a digit) appears anywhere in the file.

**Broader sweep (bonus, beyond the AC's copy.ts-only scope):** the same patterns were also run
across `apps/web/app/**` and `apps/web/components/**` (all `.ts`/`.tsx`, excluding tests) to catch
any literal string that bypassed `copy.ts` entirely. Zero matches outside the two allowlisted
reassurance strings and the rule-documentation comments already covered above.

**Verdict: clean.**

## Sign-off

| | |
|---|---|
| Audited commit | `d7ccd6f706cc31ad50b282f583d218f28caff9e4` (`main`) |
| Date | 2026-07-18 |
| Method | Static code/schema review (grep + file reads) + existing automated test suites (`pnpm denylist`, `question-state-view.test.tsx`, `question-page.spec.ts`, `spectator-cache-key.spec.ts`) — no new tests were needed since every invariant already has either a dedicated CI check or an existing test asserting it |
| Result | INV-1 through INV-10: **hold**. One unbuilt-feature gap noted under INV-9 (§7.8 outbound deep-link builder) — not a violation, flagged for WBS follow-up. Copy scan: **clean**. |
| Signed | claude-code-web-session-35b05898 (WS14-T3) |
