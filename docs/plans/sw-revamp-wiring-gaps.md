# SW revamp wiring gaps — audit + remediation tasks

## 1. What this is

A user asked to see screenshots of the live `/nemesis` and `/vs/[pairingId]` pages and noted
they didn't look consistent with the rest of the SW swipe-ux revamp (dark deck stage, Barlow
Condensed display headlines, Print-Shop card styling). Investigating that question surfaced a
repo-wide pattern: several SW5/SW8 tasks are marked `done` in the workstream-lock registry, but
their components were never actually mounted on the real pages a user visits.

This doc records the audit (§2), which components are genuinely live vs. gallery-only (§3), and
five remediation tasks (§4, registered as **SW10** in the workstream-lock registry after review round 8 returned clean — §14) that close
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
**AMENDED (fable review, see §7):** the original spec's trigger — "after the viewer's pick
LANDS during an active nemesis week, the receipt slip gains a second section" — is
unimplementable as written. The pick-placement response (`createPickResponseSchema`,
`packages/core/src/schemas/picks.ts:61`) deliberately excludes anything opponent/crowd-shaped
pre-lock ("NEVER includes crowd counts while the question is open (§9.3 — no probe-by-picking)",
same file's own comment), and `ReceiptSlip`/`SwipeBallot`'s pre-lock receipt is exactly the
surface that comment is protecting — mounting an opponent-pick reveal there would let a viewer
pick, read the opponent's side, undo (`pick-eligibility.ts`'s 60s undo window), and re-pick
against it. The authoritative trigger is now: **at reveal**, same timing as SW9's `broken_run`.
See SW10-T1.

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
**AMENDED (fable review, see §7):** (b)'s original trigger ("after the viewer's pick") has the
exact same §9.3 probe-by-picking problem as SW5-T1's — same fix, same timing: at reveal. (a) is
unaffected by this correction — it shows only a LOCKED/timing status, never the partner's side,
so it carries no pick content and can stay pre-pick/pre-lock as originally specified.

**SW5-T4 — Preset stamp reactions.** `components/nemesis/ReactionStamps.tsx` exists,
gallery-only. `components/nemesis/NemesisMatchupCard.tsx` (the real `/vs/[pairingId]` card) has
no reaction affordance at all.

**SW8-T2 — Visual gallery + snapshots (secondary finding, same "done but AC unmet" pattern,
not itself a UI wiring gap).** The task's AC requires "Playwright screenshot snapshots of the
gallery page" that "gate CI." `e2e/dev-ui.spec.ts` only makes content assertions
(`toContainText`/`toBeVisible`); no `toHaveScreenshot`/`toMatchSnapshot` call exists anywhere in
the e2e suite. There is no visual regression gate today, so a future styling regression on any
of these components would ship silently.

## 4. Tasks (registered as SW10 in the workstream-lock registry — see §14)

**SW10-T1 · Nemesis daily flip: reveal-payload data + real wiring · Depends: —**
`[contract-change]`
Spec: swipe-ux-plan §2.9 SW5-T1; this doc §3, §7 finding 1/2.
**Trigger timing corrected by fable review — read this before implementing.** The original
spec's "after the viewer's pick lands" is unimplementable: it would either leak the opponent's
pick pre-lock (violating §9.3's no-probe-by-picking rule — see `createPickResponseSchema`'s own
comment, `packages/core/src/schemas/picks.ts:61`) or, if implemented as a block on
`revealViewerSchema` but mounted on the PRE-reveal receipt (`ReceiptSlip.tsx`/`ViewerStrip.tsx`'s
pick view), would simply never render — that payload 423s (`REVEAL_NOT_READY`) until
`question.status === 'revealed'` (`app/api/v1/questions/[id]/reveal/route.ts:44-46`), which is
always after both lock and grading. This task's actual scope: **the flip fires at reveal, same
moment as SW9's `broken_run`**, not at pick time.
Deliverables: a nullable `nemesis_flip` block on `revealViewerSchema`
(`packages/core/src/schemas/questions.ts`) — `{ opponent_handle, opponent_side, opponent_side_label,
opponent_entry_cents, narration, you_wins, opponent_wins, week_label }`. **Contract-PR
sequencing (fable round 3):** the core-first `[contract-change]` PR must declare the field
`.nullish()` (optional-or-null), NOT a required nullable key — `buildRevealPayload`'s return is
`z.infer`-typed, so a required key fails `pnpm verify` in a core-only PR that doesn't touch the
emitter. The follow-up implementation PR adds the emitter and may then tighten to
`.nullable()`. The block is emitted from
`buildRevealPayload` (`apps/web/lib/reveal-payload.ts`) by a new `computeNemesisFlipBlock`,
mirroring `computeBrokenRunBlock`'s shape.
**Week-tally sourcing (fable round 5, HIGH — this is where a verbatim implementation would
ship a visibly wrong feature):** `you_wins`/`opponent_wins` must NEVER read `pairing.score`
(`nemesis_pairings.score_a/score_b`) — those columns default 0 and are written only at week
conclusion (`apps/worker/src/jobs/nemesis-conclude.ts` / `pairing-lifecycle.ts`), so every
mid-week flip would print "0–0". Derive the tallies by replaying the pairing's scoreboard
rows — count `result === 'win'` per side, skipping `pending`/`void`, mirroring
`scoreNemesisWeek`'s independent accrual — which is sound at reveal time because prior days
are already publicly resolved and unmasked (`masking.ts`). The narration triggers need a
BEFORE-tally too: same sum excluding this `question_id`.
`narration` is `string | null`, pinned in fable rounds 4-6 (no daily-flip beat exists in the
catalog, and this repo forbids freehand copy outside `copy.ts`/the `narrate()` catalog): render
via the EXISTING catalog beats only, with these mechanical triggers and slot derivations
(rounds 5-6 pinned every value — do not invent semantics):
- `nemesis_lead_taken`: emit when this question's grading flipped the week-tally leader
  (before-tally vs after-tally, as derived above). Slot `questionsLeft` = count of scoreboard
  rows with ANY non-null side whose `result === 'pending'` (per-side fields — the row has no
  top-level result; a both-sides-null row does NOT count; compute server-side where question
  status is at hand, NOT via `isPubliclyResolved`, which would wrongly exclude an unsettled
  nemesis-bonus row).
- `nemesis_comeback`: this beat is about the VIEWER coming back — all values viewer-relative,
  pinned (fable round 7): the viewer's side of the scoreboard's `a`/`b` pair is the one whose
  `profile_id` equals `viewerProfileId`; the running deficit is `opponent_wins − you_wins` over
  the date-ordered resolved DAILY rows (see the null-date rule below); emit iff the after-tally is
  LEVEL and that deficit peaked at ≥ 2 (the design doc's own "≥2 down" condition, §13.3 — a
  1-point deficit never fires; `numberWord` has no entry for 1). An OPPONENT's comeback to
  level emits nothing. Slots: `handle` = the VIEWER's own handle (the leveling player the
  template's "`${handle}` is not done" refers to — never `opponent_handle`); `deficit` = the
  peak; `downDay` = the date the peak was first reached; `levelDay` = today's `question_date`.
  `downDay`/`levelDay` render as WEEKDAY NAMES ("Thursday"), matching the catalog copy — no
  weekday formatter exists in the repo (`format-et.ts` has only clock + "Jul 08" formats), so
  this task adds a `formatWeekdayName(dateOnly)` to `format-et.ts`. Timezone-immune means:
  never parse the bare date in LOCAL time — `Date.UTC(y, m-1, d)` + `getUTCDay()` (or pure
  Zeller arithmetic) is fine; `new Date('YYYY-MM-DD')` interpreted locally is not.
  Null-date rule for the running sum: a peak is order-dependent, and nemesis-bonus rows have
  `question_date: null` with no defined position — so the comeback trace uses DAILY (dated)
  rows only; if that makes the trace's tally diverge from the full after-tally at level-check
  time in a way that flips the emission decision, emit null (degrade, don't guess).
Otherwise `narration` is null. Degrade rule: if any required slot is unresolvable,
`narration` is null — and the UI omits the line (make `NemesisFlip`'s `narration` prop
optional accordingly — SW4-T1's degrade-by-omission precedent).
Mechanical emission condition, **stated inside the existing viewer gate (fable round 5)**:
`buildRevealPayload` only constructs the `viewer` block at all when the viewer's own pick
exists and is graded non-void (`reveal-payload.ts:219-221`) — this block lives inside that
gate, so "viewer never picked / pick voided → the whole `viewer` object is absent, hence no
flip block" is the outermost case, not a separate check. Within the gate: non-null iff (a) the
viewer has an active pairing this week (`getCurrentPairingForProfile`) AND (b) the opponent has
a pick on this `question_id` (`getPick`). No pre-lock/pre-undo leak window exists:
the reveal payload is structurally unreachable pre-reveal (§6.5 publication rule, same
guarantee `computeBrokenRunBlock` already relies on). Mount `NemesisFlip` **once, in `RevealSequence.tsx`** — a
dashed-separator second section alongside (never replacing) the existing result
stamp/streak/share content, per the original mock's layout. One mount serves BOTH flag states
(corrected by fable review round 2): `DeckStates`' revealed branch is viewer-free by INV-10 and
receives viewer content only through its `viewerSlot`, which is the same
`ViewerStrip → RevealSequence` chain the flag-off path uses — do NOT add a second mount there,
it would duplicate the section and break INV-10. Also update `NemesisFlip.tsx`'s own doc
comments (lines ~6-7, ~25-26): they still describe the abandoned pick-time trigger ("revealed
only once the viewer has locked", "must not fetch before the viewer's own pick exists") and
will contradict this task's reveal-time semantics if left stale.
AC: unit test on the mechanical condition (no pairing → null; pairing but opponent hasn't
picked → null; both picked → populated; viewer no-pick or void pick → the whole `viewer` block
is absent, hence no flip block — the impossible-state case, asserted as such); tally test: a
mid-week flip on a really-seeded 3-day scoreboard shows the replay-derived tally, NOT the
`pairing.score` columns (seed them at 0 to prove it); integration test proves `getPick` for the
opponent is never called for a `locked` (not yet `revealed`) question — i.e. the block is
unreachable, not merely unpopulated, before reveal; e2e: two real seeded profiles in an active
pairing, both pick, the daily reveals, `NemesisFlip` renders with the real opponent stamp on
the viewer's reveal; flag/feature off (`nemesis` flag off, or no active pairing) → today's
reveal renders byte-identical.

**SW10-T2 · Wire VerdictCard + rematch-by-swipe into the real rematch flow · Depends: —**
Spec: swipe-ux-plan §2.9 SW5-T2; this doc §3.
Deliverables: replace `RematchPanel`'s plain button (`components/nemesis/RematchPanel.tsx`,
mounted from `NemesisHistoryList.tsx`) with `VerdictCard` + a `SwipeBallot variant="verdict"`
(or the smallest viable extraction of the existing swipe gesture engine that avoids duplicating
drag/arm/commit logic — implementer's call, but must reuse `SwipeBallot`'s core hook/state
machine, not fork it) wired to the EXISTING `POST /rematch-requests` /
`POST /rematch-requests/:id/accept` / `.../decline` endpoints `RematchPanel` already calls — no
new endpoint added. Winner vs. loser copy variant per the original AC (loser card gets the
richer, data-derived line).
**Data sourcing, corrected across both fable review rounds — this is the load-bearing part:**
`nemesisHistoryEntrySchema` (`packages/core/src/schemas/pairings.ts`) carries only
`my_score`/`their_score` plus pairing/season/opponent/outcome/rematch metadata — no edge, no
streak-of-weeks, no per-day data. But `VerdictCard`'s required props include `dayResults` (the
week dot strip) and `edgeGap` (`VerdictCard.tsx:11-14`). Resolve as follows, no contract change
needed:
- `dayResults`: derive from the EXISTING public `GET /pairings/:id`
  (`pairingPublicSchema.scoreboard` — per-question `{a,b}.{side,result}`, fully unmasked for a
  completed pairing), fetched by the `pairing_id` the history entry already carries. Mapping,
  re-pinned in fable round 4 (round 3's head-to-head "day taken" model contradicted the real
  scorer): `scoreNemesisWeek` (`packages/engine/src/scoring.ts`) awards points INDEPENDENTLY —
  a both-win day gives BOTH players +1 — and the card prints `my_score`/`their_score` (that
  scorer's output) directly above the dots, so the dots must mirror the same accrual or the
  card contradicts itself. Dot = the VIEWER'S OWN result per scoreboard row: `win` iff the
  viewer picked and won; `loss` iff picked and lost; `pending` iff the row is unsettled; the
  neutral dot (the component's `split` style, repurposed — rename the union member if clearer)
  for a void row or a viewer-no-pick row (the scorer awards nothing there). Include EVERY
  scoreboard row, nemesis-bonus rows too (null `question_date`) — the scorer counts them
  (`apps/worker/src/jobs/nemesis-conclude.ts`), so excluding them would desync dots from score.
- `edgeGap` + the verdict copy: today's LOSER line (`copy.ts:196-197`) says "`{handle}`'s edge
  beat yours by `{edgeGap}` points", and the WINNER line ("You out-edged `{handle}` when it
  counted", `copy.ts:198`) has the same problem — feeding day-win margins into edge-points
  copy renders factually false sentences. This task REWORDS BOTH lines to score-margin
  language (e.g. "took the week by {n}") and renames/retypes the prop accordingly —
  `VerdictCard` has no production call sites (that's this doc's whole point), so its prop API
  is freely changeable here.
- `outcome: 'cancelled'`: `VerdictOutcome` is `'won'|'lost'|'drew'` — a cancelled week gets NO
  verdict card; keep the existing plain history row for it.
AC: right-swipe = rematch request (D-SW9 axis, matching every other affirmative-right
convention in this codebase); BOTH verdict cards' copy asserts only score-margin facts (no
"edge"/"out-edged" wording on either card — grep both lines); a cancelled-week history row
renders without a verdict card;
`e2e/nemesis-rematch.spec.ts` (WS5-T5's suite) — its DB/state assertions (the request lands,
accept/decline transitions) must still pass, but its driving steps (today: click
`rematch-request-button`, confirm) may be rewritten for the swipe gesture, since a click-driven
flow cannot literally survive becoming a swipe; both winner/loser cards share one template with
variant props (grep test or a shared-component unit test proving no copy-pasted markup).

**SW10-T3 · Duo: sealed partner chip + wire the tandem line · Depends: —** `[contract-change]`
Spec: swipe-ux-plan §2.9 SW5-T3; this doc §3, §7 finding 1/2.
**Part (b)'s trigger timing corrected by fable review, same fix and same reasoning as
SW10-T1 — read that task's note before implementing.** Part (a) is unaffected by the timing
correction (it never carries pick content, only a locked/timing status, so it's fine to stay
pre-pick as originally scoped) — but its DATA claim was corrected in round 2: `GET /duo/current`
(`getCurrentDuoResponseSchema`, `packages/core/src/schemas/duos.ts:53-57`) returns only
`{duo, match}` — nothing about whether the partner picked today, so the chip is NOT buildable
from existing data. This task extends that response with a side-free
`partner_pick_today: { picked: boolean, picked_at: timestamp | null }` field (existence +
timing only — never the side, so §9.3 is untouched; this is part of why the task carries
`[contract-change]`). **Contract-PR sequencing (fable round 3):** declare it `.nullish()` in
the core-first PR — `fetchCurrentDuo` (`apps/web/lib/duo-client.ts`) runtime-parses responses
through this schema, so a required key deployed ahead of the handler change breaks the live duo
hub; the implementation PR updates the handler (`api/v1/duo/current/route.ts`) and may then
tighten. Handler detail: "today's question" needs a lookup the handler doesn't do today — use
the existing `getTodayDailyQuestion` (`packages/db/src/repositories/questions.ts`); truncate
`picked_at` to the minute, matching §9.2's public pick-timestamp precision posture.
Deliverables: (a) build the sealed partner chip (`▣ {partner} LOCKED · {n}h AGO`) as a new
component, mounted in `SwipeBallot`'s footer (behind `duo_queue` AND an active duo — new prop,
default omitted so every existing `SwipeBallot` call site is unaffected) — sealed means it
shows LOCKED status only, never the partner's side, ever (this chip has no "unsealed" state —
the partner's actual pick only ever surfaces via (b), post-reveal); (b) a `duo_tandem`
block on `revealViewerSchema` (`.nullish()` in the core-first PR, same sequencing rule as
SW10-T1's block) — fields, matching `DuoTandem`'s props (`DuoTandem.tsx:4-12`; the viewer's
own side comes from the payload's existing `viewer.pick`, and `viewerSideLabel` from the
question's `yes_label`/`no_label` already in `RevealSequence`'s props):
`{ partner_handle, partner_side, partner_side_label }` — populated by
`getActiveDuoForProfile` + `getPick`, emitted inside the same existing viewer gate as SW10-T1's
block (`buildRevealPayload` constructs `viewer` only for a graded, non-void own pick — a
no-pick/void viewer gets no `viewer` object at all, hence no tandem block), and within that
gate non-null iff the viewer has an active duo AND the partner has a pick on this
`question_id` — same "unreachable pre-reveal, not merely unpopulated" structural guarantee as
SW10-T1. Mount
`DuoTandem` **once, in `RevealSequence.tsx`**, next to SW10-T1's `NemesisFlip` section (same
single-mount rule as that task: `DeckStates` gets viewer content only via `viewerSlot` →
`ViewerStrip` → `RevealSequence`, so one mount covers both flag states — never a second mount
in `DeckStates`). The two sections are independent — a viewer could theoretically be in both a
duo and a nemesis pairing; stack both blocks, don't branch between them.
File coordination: SW10-T1 and this task both add a field to `revealViewerSchema`, but
they add *different* fields (`nemesis_flip` vs `duo_tandem`) — there's nothing to actually
share, so whichever contract-change PR lands second just rebases past an adjacent line; per
design doc §19.4 rule 5/§0.2, each ships as its OWN core-first `[contract-change]` PR, not a
bundle.
AC: same "unreachable pre-reveal" integration proof as SW10-T1, for `getPick` on the partner;
unit test on the mechanical condition; SPLIT renders in gold mono (already implemented in
`DuoTandem.tsx` — verify the AC, don't re-derive); chemistry/ladder UI (`DuoLadderTable.tsx`
etc.) untouched; `duo_queue` flag off → today's ballot/reveal render byte-identical.

**SW10-T4 · Wire ReactionStamps into `/vs/[pairingId]` · Depends: —** `[contract-change]`
Spec: swipe-ux-plan §2.9 SW5-T4; this doc §3, §7 findings 4/5.
Deliverables: mount `ReactionStamps` (`components/nemesis/ReactionStamps.tsx` — its own doc
comment already says "wiring to the reactions API lives in the DB-equipped session", i.e. this
task) in `NemesisMatchupCard.tsx`, wired to the existing `POST /reactions` endpoint.
`context_kind: 'pairing'` is already a valid value of `THREAD_CONTEXT`
(`packages/core/src/enums.ts`) — no context plumbing needed there. The emoji vocabulary does
need a change, but **not by extending `REACTION_SET`** (corrected by fable review): that enum
is rendered directly into every question-thread reaction picker too
(`QuestionThread.tsx:189`), keyed 1:1 against `copy.ts`'s `reactionLabels` — appending
`ReactionStamps`' four text presets ("Sweating?", "Lucky", "Called it", "Respect") to it would
inject them into every thread on the site, unlabeled. Add a SEPARATE `PAIRING_REACTION_SET`
constant (`packages/core/src/config.ts`) and a `pairingReactionEmojiSchema` validating against
it, used only when `context_kind === 'pairing'` (a discriminated/refined schema, or two
sibling request schemas — implementer's call) — this is the additive migration, not a shared
enum extension.
Server-side enforcement (corrected by fable review — do not rely on anything "existing" here,
there isn't any to reuse): `app/api/v1/reactions/route.ts` today has no block-check and no
ghost-rejection for pairing context (the route is `ghost+`, i.e. ghosts are allowed by
default — `packages/db/src/schema/social.ts:47`). Both must be added IN this task: (a) reject
a `context_kind: 'pairing'` reaction from a ghost profile server-side (the client-side claim
prompt alone is not enforcement — a direct POST would otherwise succeed); (b) block/report
severance for pairing reactions has no existing layer to call through — `lib/moderation.ts`'s
`applyBlock` only cancels the pairing/rematch state, it doesn't touch reactions — so this task
must add the block check to the reactions write path itself (mirroring whatever block-check
shape another `ghost+`-plus-block-aware endpoint in this codebase already uses as a pattern,
if one exists — otherwise a straightforward "is either party blocking the other" guard).
Read path (added by fable review round 2, INV-10 split pinned by round 3 — POST alone is half
a feature): `ReactionStamps` needs the viewer's own `selected` stamp, and the matchup page
needs to SHOW both players' stamps, but no pairing-scoped reactions read exists (`app/api/v1`
has only `questions/[id]/thread`, and the read-side `reactionCountSchema` is
`z.enum(REACTION_SET)`-typed, so it can't carry the presets either). The read MUST split along
the two pages' caching postures — do not blur this:
- **Per-player stamps** (today's reaction for player A and player B, keyed to the two
  participants): viewer-free data → carried on the cached pairing payload
  (`pairingPublicSchema`, covered by this task's `[contract-change]`; `.nullish()` sequencing
  per SW10-T1's rule) and safe for `/vs/[pairingId]` (INV-10, `revalidate = 30` — that page
  renders `viewerProfileId={null}` always and must stay that way).
- **The viewer's `selected`**: viewer data → NEVER on the ISR page's server render. Derive it
  client-side (viewer's own profile id from `/me`, matched against the per-player stamps), or
  scope the interactive picker to `/nemesis` (already `force-dynamic` with a real
  `viewerProfileId`; `NemesisMatchupCard` is mounted on both pages).
Block-severance applies on the read too; between the two players it's viewer-free, so it
belongs in the payload build, not the client.
AC: preset-only, no free-text input anywhere in the diff; a direct `POST /reactions` with
`context_kind: 'pairing'` from a ghost session is rejected server-side (test this directly, not
just via the UI's claim prompt); a blocked pair's reactions don't round-trip either direction —
verified on the READ side via the API/page payload, not just as a write rejection; the viewer's
own current stamp round-trips (post → reload → `selected` reflects it — assert on `/nemesis` or
via the client-derived path, NOT on `/vs/[pairingId]`'s ISR render, which may serve a ≤30s-stale
snapshot by design); one reaction per
player per day enforced server-side (a second same-day POST replaces or 409s — implementer
documents which); `PAIRING_REACTION_SET` values never appear in `QuestionThread.tsx`'s picker
and `REACTION_SET`'s four emoji never appear in `ReactionStamps`' picker (grep test).

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

## 7. Fable adversarial review — round 1 findings (fixed in this doc)

The first draft of §4 was reviewed before registration. §2/§3's audit facts held up completely
(every "genuinely wired" claim and every gap claim was independently re-verified against the
code); §4's task designs had two critical, codebase-invariant-violating flaws and three lesser
issues, all fixed above:

1. **CRITICAL — wrong data path/mount pair.** SW10-T1/T3(b) originally put the opponent/partner
   block on `revealViewerSchema` (post-reveal-only data) but mounted it on `ReceiptSlip`/
   `ViewerStrip`'s PRE-reveal pick view — the data would never reach the mount point. Fixed:
   both tasks now mount at reveal (`RevealSequence.tsx`, SW9-T2's precedent), matching where
   the data actually becomes available.
2. **CRITICAL — probe-by-picking hole.** The original "sealed until viewer's own pick exists"
   condition is satisfiable mid-lock-window while picks are still undoable (60s), which would
   let a viewer pick, read the opponent's/partner's side, undo, and re-pick against it —
   violating design doc §9.3. Fixed: the reveal-time redesign (finding 1) resolves this
   structurally — the data is unreachable until well after lock, undo, and grading, not merely
   gated by a same-request ordering check.
3. **HIGH — false data-availability claim.** SW10-T2's original draft claimed "edge diff or
   streak-of-weeks" were already on the nemesis history entry; `nemesisHistoryEntrySchema` only
   has `my_score`/`their_score`. Fixed: loser-card copy now specified as score-margin-derived,
   and the task no longer carries an unwarranted `[contract-change]` implication.
4. **MEDIUM — enforcement hand-waved to a layer that doesn't exist.** SW10-T4 originally said
   "reuse the existing block/report enforcement" for reactions; no such enforcement exists on
   the reactions write path, and the route is `ghost+` with no pairing-context ghost rejection.
   Fixed: both are now explicit first-class deliverables of the task, not assumed reuse.
5. **MEDIUM — enum blast radius.** Extending `REACTION_SET` directly would inject the four
   pairing-reaction text presets into every question-thread reaction picker site-wide
   (`QuestionThread.tsx`), unlabeled. Fixed: a separate `PAIRING_REACTION_SET` is now the
   specified design, not a secondary option.
6. **MEDIUM — contract-change process guidance.** The original draft suggested SW10-T1 and
   SW10-T3 could land as one bundled contract-change PR. Fixed: each ships its own core-first
   `[contract-change]` PR per design doc §19.4/§0.2; they touch different fields in the same
   file, so the only real coordination cost is a routine rebase.
7. **LOW — untestable-as-written AC.** SW10-T2's "e2e passes without weakening any assertions"
   didn't account for `e2e/nemesis-rematch.spec.ts` driving a button click that cannot survive
   becoming a swipe gesture. Fixed: the AC now explicitly scopes "no weakening" to the
   state/DB assertions, not the interaction steps.

## 8. Fable adversarial review — round 2 findings (fixed in this doc)

Round 2 verified the round-1 criticals stayed fixed (the reveal-time redesign is structurally
sound: the reveal route 423s pre-reveal, `buildRevealPayload` independently throws, undo is
pre-lock-only, and `viewerProfileId` comes solely from the authenticated cookie so
someone-else's-receipt is impossible; stacking the two blocks in `RevealSequence`'s plain
`space-y-2` result column is layout-safe). It found six second-order issues, all fixed above:

1. **HIGH — SW10-T3(a) claimed `GET /duo/current` could feed the partner chip; it can't**
   (`getCurrentDuoResponseSchema` is only `{duo, match}`). Fixed: the task now extends that
   response with a side-free `partner_pick_today` field, under its existing
   `[contract-change]` label.
2. **HIGH — SW10-T2 ignored `VerdictCard`'s required `dayResults`/`edgeGap` props**, which the
   history entry can't populate. Fixed: `dayResults` derives from the existing public
   `GET /pairings/:id` scoreboard (via the entry's `pairing_id` — no contract change);
   `edgeGap` is renamed/retyped to score margin with reworded copy.
3. **MEDIUM — `verdictLoserLine`'s "edge beat yours by N points" copy would be factually false**
   fed with day-win margins, and `outcome: 'cancelled'` had no card mapping. Fixed: reword the
   line, no verdict card for cancelled weeks.
4. **MEDIUM — SW10-T4 specified only the write path**; `selected` and displayed stamps need a
   read that doesn't exist (and `reactionCountSchema` can't carry the presets). Fixed: read
   path is now a deliverable, block-severance enforced on read too.
5. **LOW/MEDIUM — the dual-mount instruction ("RevealSequence AND DeckStates") described a
   second mount point that doesn't exist** and would break INV-10 if invented. Fixed: mount
   once in `RevealSequence`; it serves both flag states via `viewerSlot`.
6. **LOW — `NemesisFlip.tsx`'s own doc comments still describe the abandoned pick-time
   contract.** Fixed: updating them is now an SW10-T1 deliverable.

Further review rounds continue until one returns clean; only then are the tasks registered.

## 9. Fable adversarial review — round 3 findings (fixed in this doc)

Round 3 verified round 2's fixes held structurally (the scoreboard genuinely unmasks completed
pairings; `/nemesis` already imports the service for the pairing fetch; the single-mount claim
is exactly right in both flag states; all cross-references and `Depends: —` claims check out)
and found four spec-precision issues, all fixed above:

1. **MEDIUM — contract-PR sequencing.** Speccing the new fields (`nemesis_flip`, `duo_tandem`,
   `partner_pick_today`) as required-but-nullable keys would break the mandated core-first
   `[contract-change]` PR: a required key fails monorepo typecheck before the emitter exists
   (`buildRevealPayload` is `z.infer`-typed), and `fetchCurrentDuo` runtime-parses against the
   schema, so a required key deployed ahead of the handler breaks the live duo hub. Fixed: all
   three declared `.nullish()` in the core-first PR; the implementation PR may tighten.
2. **MEDIUM — SW10-T4's read path could lead into an INV-10 violation.** The viewer's
   `selected` stamp is viewer data and can never ride `/vs/[pairingId]`'s ISR render
   (`viewerProfileId={null}` always, `revalidate = 30`). Fixed: the read now explicitly splits —
   per-player stamps on the cached payload (viewer-free), the viewer's `selected` derived
   client-side or scoped to the `force-dynamic` `/nemesis` page; the round-trip AC asserts off
   the ISR page.
3. **LOW — `dayResults` mapping under-specified** (scoreboard has null-date bonus rows, `void`
   results, and no-pick rows; the card has four dot states). Fixed: mapping pinned in the task.
4. **LOW — the edge-copy reword missed the winner line**, which is equally edge-worded and
   equally unbacked by day-win data. Fixed: both lines reworded, grep AC covers both.

## 10. Fable adversarial review — round 4 findings (fixed in this doc)

Round 4 verified round 3's fixes hold (`.nullish()` is sufficient for both consumer modes and
trips no drift/registry gate; the read-path split is implementable in `buildPairingPublic`,
which both pairing endpoints share; the single-mount claim is exact) and found five issues,
all fixed above:

1. **MEDIUM — round 3's own `dayResults` mapping contradicted the real scorer.**
   `scoreNemesisWeek` awards points independently (both-win → both +1), not head-to-head, and
   nemesis-bonus rows count in the score — so round 3's "day taken" dots (and its bonus-row
   exclusion) would contradict the `my_score`/`their_score` printed directly above them.
   Fixed: dot = the viewer's OWN result per row, every scored row included.
2. **MEDIUM — that mapping was also non-deterministic** (a viewer-won/opponent-no-pick row
   matched three rules at once). The viewer-own-result re-pin dissolves this.
3. **MEDIUM — `nemesis_flip.narration` had no specced source** (no daily-flip beat exists;
   freehand copy is forbidden). Fixed: `string | null`, rendered only via the existing
   `nemesis_lead_taken`/`nemesis_comeback` catalog beats with pinned trigger rules; UI omits
   the line when null.
4. **LOW — stale present-tense "registered" wording.** Fixed: "to be registered … after a
   clean review round."
5. **LOW — `duo_tandem`'s fields were never enumerated.** Fixed:
   `{ partner_handle, partner_side, partner_side_label }`, matching `DuoTandem`'s props.

## 11. Fable adversarial review — round 5 findings (fixed in this doc)

Round 5 verified round 4's fixes (the viewer-own-result dot mapping is deterministic and
computable from the scoreboard's four `result` states; `duo_tandem`'s fields cover the
component's props; all cross-references exact) and found three issues one level deeper in the
data plumbing, all fixed above:

1. **HIGH — `you_wins`/`opponent_wins` had no valid source.** `pairing.score` columns default 0
   and are written only at week conclusion — a verbatim implementation would print "0–0" on
   every mid-week flip and the narration triggers would never fire. Fixed: tallies (and the
   before-tally the flip trigger needs) are pinned to a scoreboard-row replay mirroring
   `scoreNemesisWeek`'s accrual, with an AC seeding `score_a/b = 0` to prove the derivation.
2. **MEDIUM — the pinned narration beats' data slots were unfilled** (`questionsLeft`,
   `deficit`/`downDay`/`levelDay`), with an unhandled null-date edge on nemesis-bonus rows.
   Fixed: slot derivations pinned to the same scoreboard replay; any unresolvable slot →
   `narration` null (existing omission precedent).
3. **MEDIUM — the emission condition contradicted its host object.** `buildRevealPayload` only
   constructs `viewer` for a graded, non-void own pick, so "no viewer-lock check needed" was
   unsatisfiable as a standalone case. Fixed: both blocks are now stated as living inside that
   existing viewer gate, with the no-pick/void case added to the unit AC as the
   impossible-state assertion.

## 12. Fable adversarial review — round 6 findings (fixed in this doc)

Round 6 verified the round-5 fixes hold end to end (grading precedes the status flip, so the
scoreboard replay sees today's row unmasked at reveal time; the before-tally subtraction is
correct; no circular import between `reveal-payload.ts` and `nemesis/service.ts`; every line
citation in the doc re-checked exact) and found two blocking items plus a nit, all inside the
narration paragraph — fixed above:

1. **BLOCKING — the `nemesis_comeback` trigger dropped the catalog's "≥2 down" condition**
   (a 1-point deficit would fire, and `numberWord` can't even render 1), and
   `deficit`/`downDay` were named but never actually derived. Fixed: emit iff level after a
   peak deficit ≥ 2; deficit = the peak; downDay = date first reached; levelDay = today.
2. **BLOCKING — "the repo's existing date formatting" pointed at the wrong output shape.**
   The beats render weekday names ("Thursday"); the repo has no weekday formatter. Fixed:
   SW10-T1 adds `formatWeekdayName(dateOnly)` to `format-et.ts` (same timezone-immune
   plain-text-parse posture as `formatShortDate`).
3. **NIT — `questionsLeft` re-pinned to count rows with `result === 'pending'`** rather than
   via `isPubliclyResolved`, which would wrongly exclude an unsettled nemesis-bonus row.

## 13. Fable adversarial review — round 7 findings (fixed in this doc)

Round 7 verified the round-6 re-pins (the ≥2 trigger matches §13.3 exactly; `numberWord`
renders 2-7; the tally replay is computable; §12's log matches the text) and found one
blocking item plus three nits, all in the same narration bullet — fixed above:

1. **BLOCKING — the comeback pin never said WHOSE deficit, and the beat's `handle` slot was
   unpinned.** An either-player reading would fire the beat on the OPPONENT's comeback at the
   viewer's reveal, and the only handle in the block is `opponent_handle` — a verbatim
   implementation would narrate the wrong player's comeback. Fixed: viewer-relative deficit
   (`opponent_wins − you_wins`), `handle` = the viewer's own, opponent comebacks emit nothing.
2. **NIT — null-date bonus rows have no defined position in an order-dependent running sum.**
   Fixed: the comeback trace uses dated (daily) rows only, with a degrade-don't-guess rule if
   that diverges from the full tally at the level check.
3. **NIT — "plain-text-parse posture" read literally forbids `Date` entirely,** which honest
   weekday math doesn't satisfy. Fixed: reworded to "never parse in local time; `Date.UTC` +
   `getUTCDay()` or pure arithmetic".
4. **NIT — `questionsLeft` named a top-level `result` field the row doesn't have.** Fixed:
   any non-null side with `result === 'pending'`; both-null rows don't count.

## 14. Fable adversarial review — round 8: clean

Round 8 (micro-scoped to the round-7 amendments) verified the comeback beat's pins map 1:1
onto the catalog entry, the degrade rule is concretely computable (full after-tally vs
daily-only trace, compared at the level check), and the §13 log matches the text. Verdict:
**no blocking issues — ready to register.** Its one optional nit (state the viewer→`a`/`b`
`profile_id` equality explicitly) is applied above. Review loop closed after 8 rounds
(7, 6, 4, 5, 3, 3, 4→1-blocking, 0 findings); the SW10 tasks are registered in the
workstream-lock registry as of this revision.
