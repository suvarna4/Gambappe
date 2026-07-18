# Receipts — Demo Runbook

This is the operator script for the hackathon demo (design doc §16.1). It
assumes two devices: your laptop (driving `/admin` on a second window/tab)
and a phone (the "stranger" experience).

## Before you're on stage

1. `pnpm install`
2. Postgres reachable at `DATABASE_URL` (see `.env.example`); run migrations:
   `npx drizzle-kit migrate`
3. Set `CRON_SECRET`, `GHOST_COOKIE_SECRET`, `ADMIN_USER_IDS` (leave empty
   for an open local admin panel), and either real `AUTH_GOOGLE_ID`/`SECRET`
   or leave them unset to use the dev sign-in fallback at `/claim/dev-signin`.
4. `pnpm dev` and confirm `http://localhost:3000/` loads.
5. Dry-run the automated rehearsal once against a clean database:
   `BASE_URL=http://localhost:3000 node scripts/rehearsal.mjs`
   It should complete all 9 steps with no `LEAK` error and no non-409
   failures.
6. Open `/admin` in one tab. Bookmark it.

## The live sequence (design doc §16.1)

1. **Spectator tap.** On the phone, open the Question Zero URL
   (`/q/{id}`, printed by the rehearsal script or from `/admin`) — no
   login, no cookie. Point out: live price, "N players in", the outbound
   venue link.
2. **One-tap pick.** Tap YES. The ticket stamps invisibly-minted-ghost +
   entry price + timestamp. Point out the one-line publicness notice on
   first pick.
3. **Advance the clock from `/admin`:** click **Lock**, then pick
   **settle:yes** (type-confirm the dialog — this is the manual override,
   mirroring venue truth) on the Question Zero row.
4. **Prove the secrecy invariant (optional but a good beat):** refresh the
   phone — it shows "sealed, reveal soon," not the result. This is the
   thing the red-team review exists to prevent.
5. **Reveal.** Click **Reveal now** in `/admin`. The phone (polling every
   5s) flips to the full reveal sequence: stamp, crowd bars, percentile,
   streak.
6. **Share.** Tap Share on the phone — the generated ticket card renders
   inline; the link goes back to the same `/q/{id}` for the next stranger.
7. **Claim.** Tap the claim prompt (or go straight to `/claim`) → sign in
   (Google, or the dev fallback screen) → 18+ checkbox + publicness
   sentence → claimed. Show `/u/{handle}` — same streak, same history,
   now a public track record.
8. **Nemesis.** You'll need a second claimed account with ≥3 resolved
   picks (seed one ahead of time, or use `scripts/rehearsal.mjs` logic as
   a template — the admin panel's question list makes it fast to run a
   few more rounds). Click **Assign nemeses now** in `/admin`. Open
   `/vs/{pairingId}` — both "Meet your nemesis" framing and, once 3
   shared questions resolve, the verdict with template narration.
9. **Close on the loser's card.** Fetch
   `/api/cards/nemesis/{pairingId}?as=<the loser's side>` — same layout
   weight as the winner's, loser-framed narration. This is the
   deliberate choice, not an afterthought (P3).

## If something looks wrong mid-demo

- **Question stuck "draft":** the lifecycle sweep only opens a question
  once its market has a fresh price. Hit **Tick now** in `/admin`, or use
  the **Open** button directly (bypasses the clock).
- **Pick rejected 503:** the cached price is stale (>5 min). Tick now
  refreshes it (FakeVenue always answers).
- **Card 404s:** it's gated until the question is locked (side/entry) or
  revealed (result stamp) — this is D-16, not a bug. Lock/settle/reveal
  first.
- **Need a totally clean slate:** `psql $DATABASE_URL -c "truncate table
  picks, user_stats, questions, markets, users, rate_limits,
  nemesis_pairings, nemesis_members, nemesis_match_questions, sessions,
  oauth_states cascade;"` then re-run the rehearsal script.

## What's deliberately not in this build

Duo Queue, ladder, Houses, placement flow, wallet linking, threads,
push/email, Glicko ratings, the fingerprint pipeline, oEmbed/sitemaps —
see design doc §16.2. Everything cut is infrastructure; every invariant
in §1.3 (no money, no leaked results pre-reveal, no crowd split pre-lock,
18+ gate) is still enforced and covered by tests.
