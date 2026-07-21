# Journeys plan — the integrated app (stack · settlement · rivals · save · shell)

> Status: **approved direction** (owner decisions 2026-07-21). This document is the
> authoritative spec for the WS16–WS24 ("journeys") tasks in the workstream-lock registry
> (`docs/journeys-tasks.seed.json`). It amends `receipts-prd.md` §4.1 and parts of
> `receipts-design-doc.md` (§6.7 reveal worker, §10.1 routes, §10.3 state machine,
> §10.6 copy) — the amendments land as part of WS23-T2; until then, **where this doc
> and the design doc conflict, this doc wins** for WS16–WS24 tasks only.
>
> Visual reference: the "Gambappe — The stack, the rivals, the skin" review artifact
> (v3). Every screen named below is drawn there.

## 0. How to work a journeys task

Everything in the design doc's §0.2 and §19.4 still applies: claim your task in the
lock registry before branching (`node scripts/workstream-lock.mjs claim WS18-T1 …`),
one task per PR, branch `feat/ws18-t1-stack-feed`, `pnpm verify` green before review,
and **contract-change PRs for `packages/core` land core-first** with `.nullish()`
additive fields so consumers merge independently. Each task below lists: goal, exact
files, wiring, acceptance criteria (AC), and tests. If a task says "reuse X", reuse
X — do not fork a copy.

## 1. Decisions (locked)

| ID   | Decision                                                                                                                                                                                                                                                                                                   |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-J1 | **Ticket Stub Deluxe is the design language, systematized.** The current ticket styling is re-implemented per-screen and drifts; all card chrome moves into ONE `packages/ui` frame family (§2). Screens compose the frame; they never hand-roll perforations, stubs, headers, or stamps again.            |
| D-J2 | **One stack.** `/` deals a single deck: today's headliner first, then open topic-market cards. Right = yes, left = no, **up = skip** (card returns to the back). Only the headliner carries the streak.                                                                                                    |
| D-J3 | **Settlement follows reality.** The synchronized reveal is cut. A question settles when its venue market resolves — any time of day. The app owns the _sweat_ (open positions) and the _artifact_ (graded receipt, win/obituary), not the calendar. Supply stays daily (morning drop).                     |
| D-J4 | **Same-side scoring = price edge.** When rivals pick the same side, the better entry price wins the day (earlier stamp breaks a price tie); if both are wrong, the smaller implied loss wins. No pushes, no dead days.                                                                                     |
| D-J5 | **Rivals are the spine.** Weekly assigned nemesis stays the floor (exists). Added: call-outs (challenge a specific player via signed link — also the referral loop) and the grudge book (lifetime per-rival records, one-tap rematch, grudges seed matchmaking).                                           |
| D-J6 | **Bottom tab bar, hybrid.** Five rooms — Stack ◎, Sweat ⏳, Rivals ⚔, Crowd ◴, You ◐ — visible everywhere **except** while an open question's deck is on stage on `/`, where the bar sinks away (D-SW4 ritual preserved).                                                                                  |
| D-J7 | **You = record-first; Crowd = the boards.** `/you` is the signed-in record page (streak, accuracy, edge, topic bars, graveyard). `/crowd` wires the already-built weekly leaderboards API (overall + per-topic + edge column).                                                                             |
| D-J8 | **Sign-in is "Save".** CTA label is the single word **Save** (chip, buttons); support copy explains the mechanism ("this lives on one device…", "free", "never costs money"). No gold on any ask — gold is for wins. §10.6 pinned "claim" strings are amended (WS21-T1). The `/claim` route keeps its URL. |

Out of scope for this plan (backlog, do NOT build): daily quickfire rivals, conviction
sliders (flag exists, stays off), Houses, the Departures-board skin beyond the
flagged `/sweat` pilot (WS24-T1), native apps.

## 2. The frame system (what fixes "buggy and inconsistent")

New in `packages/ui/src/components/` (WS16-T3):

- **`TicketFrame`** — the one card shell. Props: `header?: {left, right}` (the
  ADMIT-ONE bar: mono, 2px bottom rule), `notches?: boolean` (side punch circles),
  `perf?: 'top'|'bottom'|'both'`, `stub?: {serial, barcode: boolean}` (tear-off
  footer on `paper2` with the dashed rule), `tone?: 'paper'|'board'` (board = the
  dark Departures variant, used only by WS24-T1). Children render the body.
- **`PunchWell`** — a price/side well with the dashed punch circle; `punched`
  fills it (the pick action's visual). Replaces ad-hoc `PriceTag` framing on the
  ballot (PriceTag itself remains for inline price chips).
- **`TapeLabel`** — the masking-tape state label (SAME SIDE, YOU'VE BEEN CALLED
  OUT). One implementation of the existing `.tape` look.
- **`SameSideRow`** — two `Stamp`s side by side with owner/mono captions and the
  edge line; used by matchup rows and the settle receipt.

Migration rule: `BallotCard`, `TicketCard`, `ReceiptSlip`, `ObituaryCard`,
`VerdictCard`, and the nemesis matchup ticket all become **compositions of
`TicketFrame`** — grep for `border-dashed`, perf backgrounds, and hand-rolled
headers in `apps/web/components` and `packages/ui`; after WS16-T3 + adopters, the
only perforation CSS in the repo lives inside `TicketFrame`. That is the
consistency guarantee: there is nothing left to drift.

## 3. Route map after the journeys plan

| Route                                                                 | Room   | Notes                                                                                                                             |
| --------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `/`                                                                   | Stack  | The deck (WS18-T3). Tab bar sinks while an open card is on stage.                                                                 |
| `/sweat`                                                              | Sweat  | Open positions by settle-time (WS19-T2). New.                                                                                     |
| `/rivals`                                                             | Rivals | Segmented Nemesis · Duo hub (WS17-T2). `/nemesis*`, `/duo`, `/ladder`, `/vs/*`, `/duos/*` keep working (deep links, share cards). |
| `/crowd`                                                              | Crowd  | Weekly boards (WS22-T2). New.                                                                                                     |
| `/you`                                                                | You    | Record-first; ghost variant carries the Save row (WS22-T1). New.                                                                  |
| `/claim`                                                              | —      | Save flow (URL unchanged; copy/styling per D-J8).                                                                                 |
| `/q`, `/q/[slug]`, `/p/[slug]`, `/placement`, `/settings`, `/admin/*` | —      | Unchanged locations, restyled states where noted.                                                                                 |

## 4. Data & contract changes (summary)

- `QUESTION_KIND` += `'topic'` (core + db enum). Topic questions have **no**
  `questionDate` uniqueness (the daily unique index already filters
  `kind='daily'` — verify, don't touch), no streak effect, and open/lock windows
  derived from the venue market's `close_time`.
- New table `topic_follows` (`profile_id`, `category`, `created_at`; PK
  (profile_id, category)).
- New table `callouts` (`id`, `challenger_profile_id`, `opponent_profile_id?`
  (null until accepted), `token_hash`, `status: pending|accepted|declined|expired`,
  `expires_at`, `pairing_id?`, timestamps).
- `GET /api/v1/stack` (new): `{headliner: QuestionPublic|null, topics: QuestionPublic[]}`
  — topics = open `kind='topic'` questions in the viewer's followed categories
  (ghost/no-follows default: all categories), capped 8, soonest-close first.
- `POST/DELETE /api/v1/topics/:category/follow` (new, ghost-allowed).
- `POST /api/v1/callouts` / `POST /api/v1/callouts/:token/accept` / `…/decline` (new, claimed-only accept).
- Verdict/day-result payloads gain `same_side: {your_price, their_price, winner} | null` (`.nullish()`).
- Flags (core `FLAG_DEFAULTS`): `topic_markets: false`, `callouts: false`,
  `departures_board: false` — flipped by WS23-T2 after the E2E gate.

## 5. Tasks

Phases: J0 foundations → J1 shell/supply → J2 deck/sweat → J3 rivals → J4
identity/stats → JQ integration. The DAG is in §6. **Seam rule:** tasks in the
same wave never edit the same file; where two tasks touch a shared surface
(e.g. `layout.tsx`), the earlier-wave task owns it and the later task consumes
its exported API only.

---

### WS16-T1 — Core contracts for the journeys plan [contract-change] (J0)

**Goal:** Every cross-package type/enum/flag the journeys tasks need, in one core-first PR.

**Files:** `packages/core/src/enums.ts` (`QUESTION_KIND` += `'topic'`),
`packages/core/src/flags.ts` (3 new flags, default false),
`packages/core/src/schemas/` — new `stack.ts` (`stackFeedSchema`), `topics.ts`
(`topicFollowSchema`, category = existing `MARKET_CATEGORY`), `callouts.ts`
(`calloutSchema`, `calloutCreateResponseSchema` incl. share URL), extend
`nemesis.ts` day-result with `same_side` (`.nullish()`).

**How:** additive only; every new response field `.nullish()`; re-export from
`packages/core/src/index.ts`. No consumer changes in this PR.

**AC:** `pnpm verify` green; no existing schema's parse behavior changes
(existing fixtures still validate); flags appear in `FLAG_NAMES`.

**Tests:** unit tests per new schema (valid + representative invalid).

---

### WS16-T2 — DB: topic_follows + callouts + kind='topic' (J0, depends WS16-T1)

**Goal:** Migrations + repositories for the new tables and question kind.

**Files:** `packages/db/src/schema/markets.ts` (enum flows from core constant —
regenerate), new `packages/db/src/schema/social-jx.ts` or extend `social.ts`
(`topicFollows`, `callouts` per §4), `packages/db/src/repositories/` — new
`topics.ts` (`listOpenTopicQuestions(db, categories, limit)`,
`getFollows(db, profileId)`, `setFollow`, `clearFollow`) and `callouts.ts`
(`createCallout`, `getCalloutByTokenHash`, `acceptCallout` — transactional:
flips status, creates the `nemesis_pairings` row for the next week window,
canonical a<b order — reuse the pairing insert shape from
`apps/web/e2e/nemesis-page-states.spec.ts`'s seeding), `drizzle-kit generate`
migration, factories in `src/testing/factories.ts` (`buildTopicFollow`,
`buildCallout`).

**AC:** migration applies on a fresh DB and on a DB migrated to current head;
`questions_daily_date_uq` still excludes non-daily kinds (add a regression test
inserting two same-date `topic` questions).

**Tests:** repository integration tests (`test:integration`) for each function,
incl. accept-callout idempotency (second accept fails cleanly) and expiry.

---

### WS16-T3 — packages/ui: the TicketFrame system (J0, no deps)

**Goal:** §2 in full: `TicketFrame`, `PunchWell`, `TapeLabel`, `SameSideRow`;
refactor `BallotCard` and `TicketCard` to compose `TicketFrame` (byte-identical
visuals is NOT required — _improved consistency is the point_ — but layout
structure and testids must not change); gallery tiles for every new
component/state in `apps/web/app/dev/ui`.

**How:** copy the exact CSS recipe from the v3 review artifact's Skin A
(admit header 2px rule + `.22em` mono tracking; 14px side notches; perf dots
`radial-gradient(circle, var bg 40%, transparent 46%) / 10px`; stub on `paper2`
with dashed rule + barcode `repeating-linear-gradient`). Tokens only from
`packages/ui/src/tokens.ts` — add nothing to the palette.

**AC:** grep gate: no perforation/stub/admit CSS outside `TicketFrame` in
`packages/ui` (adopting app components migrate in their own tasks); gallery
renders all states; `pnpm verify` green including the visual-regression suite —
**update baselines deliberately in this PR** (SW10-T5's gate).

**Tests:** component unit tests (render props/slots), new `toHaveScreenshot`
gallery baselines.

---

### WS17-T1 — App shell: bottom tab bar (J1, depends WS16-T3, mock-start OK)

**Goal:** The five-room tab bar (D-J6) mounted once in `apps/web/app/layout.tsx`.

**Files:** new `apps/web/components/shell/AppShell.tsx` (client) +
`TabBar.tsx`; `layout.tsx` wraps `{children}` in `AppShell`; new
`apps/web/lib/shell-context.ts` exporting `useDeckOnStage()` /
`DeckStageProvider` (a boolean context the deck sets while an open card is
full-screen).

**How:** tabs = Stack `/`, Sweat `/sweat`, Rivals `/rivals`, Crowd `/crowd`,
You `/you`; active state from `usePathname()` (prefix match; `/nemesis*`,
`/duo*`, `/ladder`, `/vs/*` highlight Rivals; `/q*` highlights Stack). Bar is
`position:fixed bottom-0` with safe-area padding, `bg` blur per the artifact's
navbar recipe; when `deckOnStage` is true it translates below the viewport
(200ms, `motion-safe` only). Until WS22/WS19 routes exist, tabs may point at
existing routes (`/rivals`→`/nemesis`, `/sweat`→`/q`, `/crowd`→`/q`, `/you`→
`/settings`) behind a small `SHELL_ROUTES` map — later tasks flip one line each.
Ghost top-bar right slot reserves a `saveChipSlot` prop (filled by WS21-T2 —
render nothing for now).

**AC:** bar on every page; hidden on `/` while today's question is open (drive
with the e2e fixture from `question-page.spec.ts`); no layout shift (reserve
height via padding on `<main>`); keyboard focusable; footer 18+ notice remains.

**Tests:** e2e `shell-nav.spec.ts`: from `/`, reach each room in ≤2 taps;
active-tab assertions; deck-on-stage hides bar.

---

### WS17-T2 — /rivals hub (J1, depends WS16-T3)

**Goal:** One Rivals room: segmented control Nemesis · Duo.

**Files:** new `apps/web/app/rivals/page.tsx`; refactor
`apps/web/app/nemesis/page.tsx` and `apps/web/app/duo/page.tsx` so their body
content is exported server components (`NemesisRoom`, `DuoRoom`) consumed by
both the old routes (kept working — deep links/share cards) and `/rivals?tab=`.
Ghost/signed-out state: instead of `redirect('/claim')` the hub renders the
neutral save-gate panel (existing `ClaimPromptBanner`, restyled copy comes with
WS21-T1 — do not block on it).

**AC:** `/rivals` renders both tabs signed-in; ghost sees the gate, not a
redirect; `/nemesis`, `/duo` unchanged for direct hits; e2e for tab switching.

**Seam:** does not touch `layout.tsx` (WS17-T1 owns it) nor copy.ts.

---

### WS18-T1 — Topic supply: curation + stack feed API (J1, depends WS16-T1, WS16-T2)

**Goal:** Admins can publish topic questions; the app can serve the stack feed.

**Files:** `apps/web/app/admin/curate/CurationClient.tsx` + its API
(`app/api/admin/markets`…): add "Publish as topic question" (creates
`kind='topic'` question: `openAt=now`, `lockAt=market.closeTime`, headline
editable, slug `{date}-{venueMarketId-slug}`); new
`apps/web/app/api/v1/stack/route.ts` per §4 using
`listOpenTopicQuestions` + the existing `getTodayQuestionPublic`; new
`apps/web/lib/stack-feed.ts` shared by the route and the `/` server render
(same delegation pattern as `lib/question-view.ts` — read the header comment
there and follow it).

**AC:** flag-gated (`topic_markets` off → `topics: []` and admin button hidden);
feed excludes locked/settled topics; cap 8; ghost default = all categories;
serialization goes through `serialize-question.ts` (INV: no outcome leaks
pre-settle).

**Tests:** integration tests for the route (follow filtering, cap, flag off);
curation e2e happy path.

---

### WS18-T2 — Topic follows: API + management UI (J1, depends WS16-T2)

**Goal:** Follow/unfollow categories, and the UI to do it.

**Files:** new `app/api/v1/topics/[category]/follow/route.ts` (POST/DELETE,
ghost-allowed — resolves profile via the ghost cookie exactly like the pick
route does; rate-limited with the existing limiter); new
`apps/web/components/TopicFollowChips.tsx` (category chips w/ counts, `chip.on`
styling) rendered in two hosts: the stack's end-of-deck state (WS18-T3 slot) and
`/you` (WS22-T1 slot) — export it standalone, hosts import.

**AC:** follows persist per profile (ghost incl.); optimistic toggle w/
rollback; flag-gated with `topic_markets`.

**Tests:** route integration tests; component unit test.

---

### WS18-T3 — The deck: single mixed stack + skip (J2, depends WS18-T1, WS16-T3; mock-start OK against a fixture feed)

**Goal:** D-J2 on `/`.

**Files:** `apps/web/app/page.tsx` (server: fetch feed via `lib/stack-feed.ts`,
pass to client), new `apps/web/components/DeckQueue.tsx` orchestrating the
existing `SwipeBallot`/`DeckStage` per card (do NOT fork SwipeBallot — extend
its props: `onSkip`, `footerSlot`), skip = up-swipe past threshold OR the
keyboard `ArrowUp`/`S` (a11y parity with the existing arrow-key picks —
see `docs/a11y-swipe-ux.md`), skipped card animates up-and-out and re-enqueues
at the back; progress chip "N of M" in the topbar; headliner card footer:
`STREAK RIDES THIS` + rival chip (`⚔ {handle} IS IN · SEALED`) when the viewer
has an active pairing and the question is shared (data already in the feed
response — WS18-T1 exposes `rival_sealed: boolean` on shared questions,
`.nullish()`); end-of-stack state: foil `Stamp` "Stack cleared", thrown/skipped
counts, top-3 sweat rows (reuse WS19-T2's `SweatRow` — if unmerged, render the
link only), link to `/sweat`; sets `deckOnStage` (WS17-T1 context) while an
open card is centered.

**AC:** with flag off, `/` is byte-identical to today (single headliner —
regression-test this); skip never hits the pick API; headliner skip shows the
one-line caveat and resurfaces before lock; deck is keyboard operable;
`prefers-reduced-motion` swaps animations for instant transitions.

**Tests:** e2e `stack-deck.spec.ts` (throw/skip/order/end-state, flag off
regression); unit tests for the queue reducer.

---

### WS19-T1 — Settlement pipeline: settle-on-resolution (J2, depends WS16-T1)

**Goal:** D-J3 server-side. A question settles when its market resolves.

**Files:** `apps/worker/` — the venue-sync job already writes
`markets.status/outcome`; add `settle:on-resolution` step in the same tick:
for each newly `resolved|voided` market with a linked question in
`open|locked`, run the existing settle/grade path (reuse the grading code the
reveal worker calls today — extract to `settleQuestion(db, questionId)` if
needed), set `revealedAt=now` (column keeps its name; presentation reads it as
"settled at" — renaming the column is NOT in scope), fire the existing
revalidate + web-push calls (push copy: "⚡ {headline} — it's done. Your receipt
just graded itself."); delete the clock-scheduled reveal ceremony job
registration; add `settle:digest` (21:00 ET daily): if a profile had ≥2 settles
that day, send one summary push instead of having sent per-settle pushes after
the first — implement as: per-settle push only for the first settle of the
day per profile, digest covers the rest.

**AC:** worker integration test: resolving a market grades picks and stamps
`revealedAt` within one tick; voided market → voided question, streaks
unaffected (existing rule); no job remains that fires reveals by clock; ISR
revalidation still hits (`/internal/revalidate`).

**Seam:** worker-only + one extracted lib; no web UI changes here.

---

### WS19-T2 — Sweat surfaces (J2, depends WS19-T1 mock-start OK, WS17-T1)

**Goal:** `/sweat` + settled-state presentation.

**Files:** new `apps/web/app/sweat/page.tsx` (force-dynamic, viewer-scoped —
ghost via cookie, claimed via session; lists the viewer's `pending` picks
joined to questions+markets: headline, side+entry price `Stamp`, drift
`now yes_price − entry` colored win/loss, settle-when label — `LIVE` if market
close < 2h, weekday if < 7d, else `~MON YYYY`; sorted soonest-first; empty
state links to `/`); new `components/SweatRow.tsx` (exported for WS18-T3);
question-page states: replace countdown-to-reveal presentation in
`QuestionStateView` locked state with "SETTLES WHEN IT SETTLES — {close-time
label}" + crowd-at-lock; settled state header `SETTLED {time}` (uses
`revealedAt`); the reveal _choreography_ (stamp slam etc.) still plays — it
just plays whenever the page first shows the settled state.

**AC:** `/sweat` renders for ghost and claimed; SSR reads DB directly (repo
pattern); no viewer data on ISR pages (INV-10 — `/sweat` is dynamic, fine);
`copy.ts` gains the new strings (money-word lint passes).

**Tests:** e2e: seed open+settling picks, assert ordering/labels; settled
question page state snapshot.

---

### WS20-T1 — Engine: same-side price-edge scoring [contract-change] (J2, depends WS16-T1)

**Goal:** D-J4 in the engine's day scoring.

**Files:** `packages/engine/` day-scoring for pairings (find the module WS4/WS5
used for `scoreA/scoreB` day tallies); when both rivals' graded picks share a
side: winner = better entry price for that side (lower cost of the taken
position), tie → earlier `priceStampedAt`, still tied (same minute truncation)
→ genuine draw for the day; both-wrong same-side: winner = smaller implied
loss (same comparison — document that it reduces to the same price rule);
populate `same_side` in the day-result payload (WS16-T1 schema).

**AC:** exhaustive unit table: {same side yes/no} × {outcome yes/no/void} ×
{price equal/unequal} × {timestamp order}; void days unchanged; opposite-side
days byte-identical to current behavior (regression fixtures).

---

### WS20-T2 — Same-side UI (J3, depends WS20-T1 mock-start OK, WS16-T3)

**Goal:** The same-side card state on matchup surfaces.

**Files:** `apps/web/components/nemesis/NemesisMatchupCard.tsx` +
`VerdictCard.tsx` day rows: when `same_side` present render `SameSideRow`
(both stamps w/ prices + owner captions), `TapeLabel` "SAME SIDE · EDGE
DECIDES", footer line "YOUR PRICE BEATS THEIRS BY {n}¢" (or the inverse) pre-
settle, and the day-winner framing "both right — you called it cheaper" /
"both wrong — they lost less" post-settle (strings in `copy.ts`, exact wording
from the v3 artifact ch. 03).

**AC:** opposite-side rows unchanged; sealed opponent still sealed pre-lock
(same-side state only appears once both picks are public per existing seal
rules); gallery tile + baseline for the state.

---

### WS20-T3 — Call-outs: API + lifecycle (J3, depends WS16-T1, WS16-T2)

**Goal:** D-J5's challenge links, end to end on the server.

**Files:** new `app/api/v1/callouts/route.ts` (POST, claimed-only: creates row,
mints URL `{APP_URL}/rivals?callout={token}` — token random 32B, store hash
only, 24h expiry), `app/api/v1/callouts/[token]/route.ts` (GET public preview:
challenger handle/record — spectator-safe fields only; POST accept
claimed-only → `acceptCallout` repo (WS16-T2) creating next-week pairing;
POST decline), rate-limited (reuse limiter), flag `callouts`.

**AC:** accept is transactional + idempotent; expired token → 410 with clean
error shape; a player with an active accepted call-out pairing isn't
double-assigned by the Monday matchmaking for that week (add the guard where
weekly assignment queries eligible profiles — one WHERE clause + test);
ghost hitting accept gets 401 with `{reason: 'save_required'}`.

---

### WS20-T4 — Call-outs UI + grudge book (J3, depends WS20-T3, WS17-T2)

**Goal:** The social surfaces: issue/receive call-outs; lifetime rival records.

**Files:** in `/rivals` (WS17-T2's hub): "Call someone out" panel — rival
candidates from nemesis history (`GET /me/nemesis-history`) + a copy-link
share button (`navigator.share` fallback clipboard, reuse the share-sheet
component); incoming call-out card (`TapeLabel` "YOU'VE BEEN CALLED OUT",
challenger record, Accept the duel / Decline — accept while ghost routes
through the Save flow with `?next=` return); grudge book: extend
`NemesisHistoryList` rows to lifetime aggregate per rival (`they lead 2–1`)
with the existing rematch affordance surfaced as `REMATCH`; matchmaking
priority: where weekly assignment ranks candidates, add a bounded boost for
opponents with standing 1–1+ records (small, engine-side, with test).

**AC:** full loop e2e: A creates link → B (fresh ghost) opens preview → saves →
accepts → pairing exists for next week and both `/rivals` screens show it;
declined/expired call-outs render correctly; no free-text anywhere (stamps
only).

---

### WS21-T1 — "Save": copy + /claim restyle (J3, depends WS16-T3)

**Goal:** D-J8. Kill "claim" language and the off-brand sign-in screen.

**Files:** `apps/web/lib/copy.ts`: `CLAIM_PROMPT_CTA = 'Save'`; the two pinned
nudge strings become: streak → `Your streak lives on this device. Save it —
free, ten seconds.`; fingerprint → `Your fingerprint is ready. Save your
record to get your nemesis.` (update the "pinned verbatim" header comment to
cite this doc + owner decision; run the §10.6 money-word lint); `/claim`
page: render inside `TicketFrame` (paper card, admit header `GAMBAPPE ·
SAVE YOUR RECORD`), heading `Nothing to buy. Just don't lose your record.`,
sub `Free — email, Google, or passkey. Nothing here ever costs money.`, button
labels `Continue with Google` (keep) and `Save` for the email submit; neutral
palette only — **no gold anywhere on this screen**; signed-in state shows the
saved-record confirmation (existing completion component, restyled copy).

**AC:** grep gate: no user-facing "claim"/"Claim" string remains in `copy.ts`
or page components (route path `/claim` and code identifiers exempt — renaming
identifiers is NOT in scope); e2e claim-flow spec updated and green; money-word
lint green.

---

### WS21-T2 — Save chip + value triggers (J4, depends WS17-T1, WS21-T1)

**Goal:** The ambient Save entry points.

**Files:** fill WS17-T1's `saveChipSlot`: ghost-with-value (streak ≥1 or picks
≥1) sees a neutral chip labeled **`Save`** (dim border, never gold) linking
`/claim?next={path}`; the existing claim-prompt engine (`lib/` WS7-T5 trigger
code) keeps its triggers (streak 3, 5th pick, rival-surface view) + new
trigger: incoming call-out — all rendering the WS21-T1 copy in the neutral
`TicketFrame` card (v3 artifact ch. 08-B layout: record summary line → fact →
`Save` + `Not now`); `/you` ghost variant's save row (WS22-T1 exposes the slot).

**AC:** chip appears only when there's value to lose; dismissals persist per
trigger (existing behavior); no gold token used anywhere in the ask components
(assert via a unit test on rendered classnames).

---

### WS22-T1 — /you: record-first (J4, depends WS17-T1)

**Goal:** D-J7's You room.

**Files:** new `apps/web/app/you/page.tsx` (dynamic, viewer-scoped): claimed →
stat trio (streak w/ freeze note, lifetime accuracy, edge), topic bars
(existing `category_shares` data via the profile serializer — reuse
`lib/profile-page.ts` pieces), graveyard shelf (existing `GraveyardShelf`),
links: public profile `/p/{slug}`, `/settings`; ghost → same layout with
forming-state placeholders + WS21-T2's save row + `TopicFollowChips` (WS18-T2);
flip `SHELL_ROUTES.you` to `/you`.

**AC:** reuses the `/p/[slug]` components (no forked stat markup — extract to
shared components under `components/profile/` if needed); ghost and claimed
e2e snapshots.

---

### WS22-T2 — /crowd: the boards (J4, depends WS17-T1)

**Goal:** D-J7's Crowd room on the already-built API.

**Files:** new `apps/web/app/crowd/page.tsx`: category chip row (`Overall` +
`MARKET_CATEGORY`), table rank · handle(+streak flame) · ACC · EDGE via
`GET /api/v1/leaderboards/weekly` (server-fetch through the lib, not
self-HTTP — repo pattern), viewer's row pinned/highlighted when present
(`lbrow.me` treatment), footer legend `ACC = calls right · EDGE = price beaten
at entry`; link each handle to `/p/[slug]`; flip `SHELL_ROUTES.crowd`.

**AC:** empty-week state; ISR 60s (no viewer data server-rendered — viewer
highlight hydrates client-side, INV-10); e2e with seeded board.

---

### WS23-T1 — Journey E2E gate (JQ, depends WS18-T3, WS19-T2, WS20-T2, WS20-T4, WS21-T2, WS22-T1, WS22-T2)

**Goal:** Prove the vision end to end, as journeys, not screens.

**Files:** new `apps/web/e2e/journeys/*.spec.ts`: (1) fresh visitor lands on
`/` → throws headliner → throws a topic card → skips one → end-of-stack →
`/sweat` shows 2 positions; (2) market resolves (drive repositories like
`golden-loop.spec.ts` does) → settled state + streak tick → obituary path for
a loss; (3) ghost with a streak sees the Save chip → saves → record intact →
nemesis assigned surfaces on `/rivals`; (4) same-side week: both rivals pick
yes at different prices → matchup shows SAME SIDE → settle → day winner by
edge; (5) call-out loop (WS20-T4's AC promoted to the gate); (6) reachability
matrix: every room + `/settings` + `/p/[slug]` reachable from `/` in ≤2 taps
with the deck open-then-cleared. Visual baselines refreshed once, deliberately.

**AC:** suite green in CI with all journeys flags ON (set in `playwright.config.ts`
like `FLAG_NEMESIS` is today); flake rate over 20 CI runs < 1% (§19.3 bar).

---

### WS23-T2 — Rollout + doc amendments (JQ, depends WS23-T1)

**Goal:** Flip it on and make the paper record match reality.

**Files:** flag defaults `topic_markets`/`callouts` → environments (prod env
vars, not code defaults — follow how `duo_queue` shipped); delete dead
reveal-ceremony copy/jobs left by WS19; amend `receipts-prd.md` §4.1 (one
synchronized reveal → settle-on-resolution + morning drop), `receipts-design-doc.md`
§6.7 (reveal worker → settle pipeline), §10.1 (route table += `/sweat`,
`/rivals`, `/crowd`, `/you`), §10.3 (state presentation), §10.6 (Save strings),
each amendment referencing this plan; update `CLAUDE.md` pointer if needed.

**AC:** `pnpm verify` green; a fresh reader of the design doc finds no
contradiction with the shipped app on these surfaces.

---

### WS24-T1 — STRETCH: Departures-board pilot on /sweat (JQ, depends WS19-T2, WS16-T3)

Flag `departures_board`. `TicketFrame tone='board'` + a `FlapText` primitive
(per-character cells, split hairline, tick animation on settle, reduced-motion
static): `/sweat` renders rows as an arrivals board. Gallery tile + baseline.
Ship dark, keep receipts paper. Do not start before JQ's required tasks are
in review.

## 6. The DAG

```
J0:  WS16-T1 ──► WS16-T2          WS16-T3
            │        │            │
J1:         │   ┌────┴───┐   ┌───┼──────────┐
            ▼   ▼        ▼   ▼   ▼          ▼
        WS18-T1  WS18-T2   WS17-T1  WS17-T2   WS21-T1*
            │        │       │       │        │
J2:         ▼        │       ▼       │        │
        WS18-T3 ◄─────┘   WS19-T2 ◄─ WS19-T1    │
            │                │   (J2, dep WS16-T1)
J2/3:   WS20-T1 ─► WS20-T2     │                │
        WS20-T3 ─► WS20-T4 ◄───┼── (dep WS17-T2) │
J4:     WS21-T2 ◄─ (WS17-T1) ◄─┘ ◄──────────────┘
        WS22-T1  WS22-T2  (dep WS17-T1)
JQ:     WS23-T1 (dep: WS18-T3 WS19-T2 WS20-T2 WS20-T4 WS21-T2 WS22-T1 WS22-T2) ─► WS23-T2
        WS24-T1 (stretch)
* WS21-T1 deps only WS16-T3 — it can run in J1.
```

Maximum safe parallelism per wave: J0 ×3 → J1 ×5 (WS18-T1, WS18-T2, WS17-T1,
WS17-T2, WS21-T1) → J2 ×3 (WS18-T3, WS19-T1→WS19-T2, WS20-T1) → J3 ×3 (WS20-T2,
WS20-T3→WS20-T4 chain) → J4 ×3 (WS21-T2, WS22-T1, WS22-T2) → JQ serial.

## 7. Seam contracts (read before claiming)

1. `layout.tsx` is owned by WS17-T1 alone; everyone else consumes `AppShell`
   props/slots.
2. `copy.ts` new-string ownership: WS19-T2 (sweat/settle), WS20-T2 (same-side),
   WS20-T4 (call-outs), WS21-T1 (save). Strings land with their feature PR —
   never edit another task's block.
3. `SwipeBallot` is extended by WS18-T3 only (new optional props); WS20-T2 and
   others consume rendered slots.
4. Core schema files: one task per file (see WS16-T1's layout) so later
   contract-change PRs (WS20-T1) touch only their own module.
5. `SHELL_ROUTES`: WS17-T1 creates it pointing at today's routes; WS19-T2,
   WS22-T1, WS22-T2, WS17-T2 each flip exactly their own entry.
6. Flags: no journeys feature renders with its flag off. Flag-off = today's app,
   asserted by regression e2e in WS18-T3 and WS19-T2.
