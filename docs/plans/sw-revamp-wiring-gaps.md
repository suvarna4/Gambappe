# SW revamp wiring gaps — audit + remediation tasks

## 1. What this is

A user asked to see screenshots of the live `/nemesis` and `/vs/[pairingId]` pages and noted
they didn't look consistent with the rest of the SW swipe-ux revamp (dark deck stage, Barlow
Condensed display headlines, Print-Shop card styling). Investigating that question surfaced a
repo-wide pattern: several SW5/SW8 tasks are marked `done` in the workstream-lock registry, but
their components were never actually mounted on the real pages a user visits.

This doc records the audit (§2), which components are genuinely live vs. gallery-only (§3), and
five remediation tasks (§4, registered as **SW10** in the workstream-lock registry) that close
each gap. §5 corrects the record on the five original tasks.

## 2. How the gap was found, and how every other SW task was checked

`docs/swipe-ux-plan.md` §3.3's deliverables describe REAL page integration, not component
existence: SW5-T1 says "receipt-slip **second section**... fed by the existing matchup
endpoint"; SW5-T2 says "**wired to** the existing rematch request/decline actions"; SW5-T4 says
"the four preset stamps **on matchup pages**." The verification method for this audit was
mechanical: for every SW task whose deliverable is a UI component, grep for that component's
name across `apps/web/app/**` and `apps/web/components/**` (excluding its own file, its own
test, and `apps/web/app/dev/ui/page.tsx`, which is the internal gallery). A component with zero
hits outside the gallery is not wired into anything a visitor can reach.

Every SW0–SW9 task was checked this way. Confirmed **genuinely wired** (not touched by this
plan): SW1 (BallotCard/SwipeBallot/ReceiptSlip/ViewerStrip — live on `/`, `/q/[slug]`), SW2
(DeckStage/DeckStates — live behind `swipe_ballot`), SW2-T3 (side-axis sweep — enforced by
`scripts/check-side-axis.mjs`, part of `pnpm lint`), SW3-T1 (`RevealHush` — live in
`DeckStates`), SW3-T2 (`Stamp`'s `foil`/`punch` inks are the *default* ink for the
`called_it`/`void` variants inside `packages/ui/src/components/Stamp.tsx` itself, so every
existing `<Stamp variant="called_it">`/`<Stamp variant="void">` call site — several, all
live — already renders the new ink with no separate wiring step needed), SW4 (`ObituaryCard`,
`GraveyardShelf`, the Print-Shop `templates.tsx` restyle — all five OG template functions
reference `printShop.*` tokens directly; SW4-T1/T3's original triggers were the two tasks
`docs/plans/obituary-handoff.md` (SW9) already fixed and this session verified end-to-end),
SW6-T1 (`PlacementSwipeCard` — live on `/placement`; note it's statically prerendered, so a
build must actually receive `FLAG_SWIPE_BALLOT` in its env — Turbo's `globalPassThroughEnv` in
`turbo.json` does not currently list it, so `pnpm build` silently strips it and bakes in the
flag-off render regardless of the runtime flag; `next build` run directly inside `apps/web`
picks it up correctly), SW7 (the real service worker `apps/web/public/sw.js` implements
`notificationclick`; `?arm=1` threads through `app/page.tsx` → `ViewerStrip` → `SwipeBallot`
with a client self-detect fallback for `/q/[slug]`), SW8-T1 (`e2e/a11y.spec.ts` runs axe;
`docs/a11y-swipe-ux.md` exists), SW8-T3 (`ViewerStrip`'s `handlePick` calls
`postAnalyticsEvent('pick_created', { source })` with `source` sourced from `SwipeBallot`'s
`submit(side, source)` — real, live).

## 3. The gaps

**SW5-T1 — Nemesis daily flip.** `components/nemesis/NemesisFlip.tsx` exists, is unit-tested
(`test/nemesis-flip.test.tsx`), and renders in the `/dev/ui` gallery only. It is never imported
by `ReceiptSlip.tsx`, `SwipeBallot.tsx`, or `ViewerStrip.tsx`. Deeper than a mount, though: there
is no data path for "the opponent's pick on today's question" anywhere in
`apps/web/lib/reveal-payload.ts` or `apps/web/lib/nemesis/service.ts` — `revealViewerSchema`
(`packages/core/src/schemas/questions.ts`) has no nemesis field at all. The primitives to build
one exist (`getPick(db, questionId, profileId)`, `packages/db/src/repositories/picks.ts`, plus
`getCurrentPairingForProfile`, `apps/web/lib/nemesis/service.ts`) but nobody has assembled them.

**SW5-T2 — Verdict cards + rematch-by-swipe.** `components/nemesis/VerdictCard.tsx` exists,
gallery-only. The real `/nemesis` hub (`app/nemesis/page.tsx` →
`components/nemesis/NemesisHistoryList.tsx`) still renders the pre-SW5
`components/nemesis/RematchPanel.tsx` — a plain button ("Request rematch"), confirmed in a live
screenshot this session. `RematchPanel` has zero reference to `VerdictCard` or `SwipeBallot`.

**SW5-T3 — Duo shared-deck states.** Two separate deliverables, both missing:
(a) the "sealed partner chip on the ballot footer" was never built at all — there is no
component by any name for it anywhere in the repo, gallery included; (b)
`components/duo/DuoTandem.tsx` (the MATCHED/SPLIT receipt line) exists, gallery-only, same
unwired pattern as SW5-T1. The data primitive for (b) exists —
`getActiveDuoForProfile(db, profileId)` (`packages/db/src/repositories/duo-matches.ts`) plus
`getPick` — nobody has assembled it into the reveal payload either.

**SW5-T4 — Preset stamp reactions.** `components/nemesis/ReactionStamps.tsx` exists,
gallery-only. `components/nemesis/NemesisMatchupCard.tsx` (the real `/vs/[pairingId]` card) has
no reaction affordance at all.

**SW8-T2 — Visual gallery + snapshots (secondary finding, same "done but AC unmet" pattern,
not itself a UI wiring gap).** The task's AC requires "Playwright screenshot snapshots of the
gallery page" that "gate CI." `e2e/dev-ui.spec.ts` only makes content assertions
(`toContainText`/`toBeVisible`); no `toHaveScreenshot`/`toMatchSnapshot` call exists anywhere in
the e2e suite. There is no visual regression gate today, so a future styling regression on any
of these components would ship silently.

## 4. Tasks (registered as SW10 in the workstream-lock registry)

**SW10-T1 · Nemesis daily flip: reveal-payload data + real wiring · Depends: —**
`[contract-change]`
Spec: swipe-ux-plan §2.9 SW5-T1; this doc §3.
Deliverables: a nullable `nemesis_flip` block on `revealViewerSchema`
(`packages/core/src/schemas/questions.ts`) — `{ opponent_handle, opponent_side, opponent_side_label,
opponent_entry_cents, narration, you_wins, opponent_wins, week_label }` — emitted from
`buildRevealPayload` (`apps/web/lib/reveal-payload.ts`) by a new `computeNemesisFlipBlock`,
mirroring `computeBrokenRunBlock`'s shape. Mechanical emission condition: non-null iff (a) the
viewer has an active pairing this week (`getCurrentPairingForProfile`) AND (b) the viewer's own
pick on `question_id` already exists (the same request that's building this payload — never a
separate pre-check, so "sealed until the viewer locks" is structural, not a timing race) AND
(c) the opponent has a pick on the same `question_id` (`getPick`). Mount `NemesisFlip` in
`ReceiptSlip.tsx` (SwipeBallot's receipt) AND in `ViewerStrip.tsx`'s plain-flow pick view,
behind the block being non-null — both receipt call sites, so parity holds whether or not
`swipe_ballot` is on.
AC: integration test proves the opponent-pick query never runs before the viewer's own pick
exists in the same request (assert via a spy/count, not just "eventually correct"); unit test
on the mechanical condition (no pairing → null; pairing but opponent hasn't picked → null;
both picked → populated); e2e: two real seeded profiles in an active pairing, viewer picks and
locks, `NemesisFlip` renders with the real opponent stamp; flag/feature off (`nemesis` flag off,
or no active pairing) → today's receipt renders byte-identical.

**SW10-T2 · Wire VerdictCard + rematch-by-swipe into the real rematch flow · Depends: —**
Spec: swipe-ux-plan §2.9 SW5-T2; this doc §3.
Deliverables: replace `RematchPanel`'s plain button (`components/nemesis/RematchPanel.tsx`,
mounted from `NemesisHistoryList.tsx`) with `VerdictCard` + a `SwipeBallot variant="verdict"`
(or the smallest viable extraction of the existing swipe gesture engine that avoids duplicating
drag/arm/commit logic — implementer's call, but must reuse `SwipeBallot`'s core hook/state
machine, not fork it) wired to the EXISTING `POST /rematch-requests` /
`POST /rematch-requests/:id/accept` / `.../decline` endpoints `RematchPanel` already calls — no
new endpoint added. Winner vs. loser copy variant per the original AC (loser card gets the richer,
data-derived line — edge diff or streak-of-weeks, both already available on the history entry
`NemesisHistoryList` renders).
AC: right-swipe = rematch request (D-SW9 axis, matching every other affirmative-right
convention in this codebase); `e2e/nemesis-rematch.spec.ts` (WS5-T5's suite) passes against the
new UI without weakening any of its assertions; both winner/loser cards share one template with
variant props (grep test or a shared-component unit test proving no copy-pasted markup).

**SW10-T3 · Duo: sealed partner chip + wire the tandem line · Depends: —** `[contract-change]`
Spec: swipe-ux-plan §2.9 SW5-T3; this doc §3.
Deliverables: (a) build the sealed partner chip (`▣ {partner} LOCKED · {n}h AGO`) as a new
component, mounted in `SwipeBallot`'s footer (behind `duo_queue` AND an active duo — new prop,
default omitted so every existing `SwipeBallot` call site is unaffected) — sealed means it
shows LOCKED status only, never the partner's side, until the viewer's own pick exists; (b) a
nullable `duo_tandem` block on `revealViewerSchema` (same file as SW10-T1's block — coordinate
the two additions in one contract-change PR if both land close together, otherwise whichever
lands first adds the field), populated by `getActiveDuoForProfile` + `getPick`, mounted via
`DuoTandem` in `ReceiptSlip.tsx`/`ViewerStrip.tsx` next to SW10-T1's nemesis section (they are
independent, mutually-exclusive-in-practice sections — a viewer could theoretically be in both
a duo and a nemesis pairing; stack them, don't branch).
AC: same sealed-fetch proof as SW10-T1 (partner pick never queried before viewer's own pick
exists in the same request); SPLIT renders in gold mono (already implemented in
`DuoTandem.tsx` — verify the AC, don't re-derive); chemistry/ladder UI (`DuoLadderTable.tsx`
etc.) untouched; `duo_queue` flag off → today's ballot/receipt render byte-identical.

**SW10-T4 · Wire ReactionStamps into `/vs/[pairingId]` · Depends: —** `[contract-change]`
Spec: swipe-ux-plan §2.9 SW5-T4; this doc §3.
Deliverables: mount `ReactionStamps` (`components/nemesis/ReactionStamps.tsx` — its own doc
comment already says "wiring to the reactions API lives in the DB-equipped session", i.e. this
task) in `NemesisMatchupCard.tsx`, wired to the existing `POST /reactions` endpoint. Half of
"the existing reactions API if it fits" already does: `context_kind: 'pairing'` is already a
valid value of `THREAD_CONTEXT` (`packages/core/src/enums.ts`), reused by
`reactionContextSchema`/`context_kind` (`packages/core/src/schemas/threads.ts`) — no context
plumbing to add. The other half doesn't fit as-is: `emoji` is strictly
`z.enum(REACTION_SET)` (`reactionEmojiSchema`, same file) and `REACTION_SET` (`packages/core/
src/config.ts`) is today's fixed 4-emoji set (🔥💀🧾🫡) — `ReactionStamps`' four text presets
(`nemesisCopy.reactionStamps`: "Sweating?", "Lucky", "Called it", "Respect") don't validate
against it. The additive migration: extend `REACTION_SET` with these four values (or add a
second `z.enum` specifically for pairing-context reactions if mixing text presets into the
emoji-only thread-reaction picker reads wrong product-wise — implementer's call, discuss in the
PR if ambiguous) and thread the choice through `reactionEmojiSchema`. One reaction per player
per day; ghosts see but can't send (claim prompt per design doc §11.3); block/report severs
delivery both ways (reuse the existing block/report enforcement — verify which layer currently
owns that check and call through it, don't reimplement).
AC: preset-only, no free-text input anywhere in the diff; e2e proves a ghost sees existing
reactions but tapping one triggers the claim prompt instead of a request; a blocked pair's
reactions don't round-trip either direction.

**SW10-T5 · Visual regression gate for the `/dev/ui` gallery · Depends: —**
Spec: swipe-ux-plan §3.3 SW8-T2's un-met AC; this doc §3.
Deliverables: `toHaveScreenshot` assertions in `e2e/dev-ui.spec.ts` (or a new
`e2e/dev-ui-visual.spec.ts` alongside it, implementer's call) covering every tile the gallery
already renders (ballot rest/drag/armed/receipt, all four stamp inks, obituary card, deck
states, verdict variant, and SW10-T1–T4's new tiles once those land — this task can ship before
or after SW10-T1–T4; if before, add their tiles in those tasks' own PRs, not here); baseline
snapshots committed; wired into the CI e2e job so a diff fails the build.
AC: a deliberate one-pixel style change to any covered component fails CI locally
(demonstrate in the PR description, then revert the deliberate change before merge); snapshot
diffs are reviewable in the PR (upload as an artifact or inline, matching whatever this repo's
CI already does for Playwright failure artifacts — `.github/workflows/ci.yml` already uploads
`playwright-report` on failure, extend that rather than inventing new plumbing).

## 5. Correcting the record

`SW5-T1`, `SW5-T2`, `SW5-T3`, `SW5-T4`, and `SW8-T2` are marked `done` in the workstream-lock
registry. This doc does not reopen them (their components genuinely exist and are tested,
which is real, non-zero progress) — it registers SW10-T1–T5 as the completion work and each
original entry's `note` field is updated to point here, so a future agent auditing the registry
sees the correction without needing to rediscover it.

## 6. Out of scope

- Re-litigating whether the SW5/SW8 components' own visual design is correct — this doc is
  about wiring, not restyling anything already built.
- Native surfaces (SW7-T3, doc-only, unaffected).
- Any workstream outside SW (the WS-prefixed and other SW9-adjacent work is unaffected).
