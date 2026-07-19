# Obituary handoff v2 — scope, semantics, and tasks (SW9)

**Status:** approved scope for the SW9 tasks registered in the workstream-lock registry.
**Supersedes:** `docs/swipe-ux-plan.md` §2.6's "Obituary handoff" bullet and the obituary
lines of the SW3-T2 / SW4-T1 WBS entries, whose trigger phrasing ("when `viewer.streak`
broke this reveal") is unimplementable as written — see §1.
**Prior art:** PR #75 shipped and then reverted a first implementation; its review record
(in the PR description) is the post-mortem this scope is built on. The `ObituaryCard`
component (SW4-T1), the busted-streak OG/card template (SW4-T2), `obituaryCopy`
(`apps/web/lib/copy.ts`), `OBITUARY_MIN_STREAK` (`packages/ui/src/swipe.ts`), and the
`GraveyardShelf` component (SW4-T3, currently `/dev/ui`-only) all exist and are reused
here — this plan adds the *data*, not the surfaces.

## 1. Why the first attempt was structurally dead

The daily streak (design doc §6.6, DD-3) is a **participation** streak. At the reveal of
day D, every participant's `current_streak` is *incremented* — including losers. The
streak only resets on an **uncovered missed day**, applied either by `streak:sweep`
(03:30 ET next day) or by the gap-rule walk at the next reveal the profile participates
in (`packages/db/src/streak-replay.ts`, the `answered` branch: gap check, *then* `+= 1`).

Consequences, verified against `replayStreak` and `computeViewerStreakBlock`
(`apps/web/lib/reveal-payload.ts`):

- For a participant, `viewer.streak.current` is always ≥ 1 after their own reveal, and
  `delta` is always exactly `+1` (any gap-reset is already reflected in the `before`
  replay, which runs through yesterday). A trigger of the form
  `result === 'loss' && current === 0` can never fire.
- A participation streak **cannot break at a reveal you participated in**. It breaks in
  your absence. By the time you next show up, the payload's before/after diff has
  already absorbed the break — the dead run's length is simply not in the contract.

Any implementation keyed off the existing `viewer.streak` block is therefore dead code,
and any test proving it works must fabricate a payload shape the server cannot emit
(which is exactly what happened). **Rule for SW9: every test of the trigger path must
drive the real reveal endpoint against really-seeded history. No `page.route` payload
mocks for trigger semantics.**

## 2. The correct semantics: the funeral happens at the wake

The mock (`docs/mockups/swipe-ux.html` §obituary) is unambiguous about what is being
mourned: *"Here lies an 11-day streak"*, graveyard chips `RIP 11 / RIP 6 / RIP 3` — these
are participation-run lengths (the flame number, the thing freezes protect and the
pre-lock reminder threatens). *"Died holding HOLDS @ 29¢"* is the run's **final
position**: death is by absence, and the pick is what the streak was holding when it
died. It does not need to be — and often will not be — a losing pick.

So the obituary shows at the **first reveal the viewer attends after a run has died**:
you come back, and there's a funeral. Concretely, the server emits the dead-run block
when *the current run began on this question's date* — i.e. this reveal is the viewer's
first counted daily since the break. This fires exactly once per death in the normal
flow (tomorrow, the current run will have started yesterday, not "today").

**Decision record — participation streak, not win streak.** A `loss → current_win_streak
= 0` reset *does* happen at the participated reveal, and a win-streak obituary would be
derivable with the existing before/after machinery. Rejected for v1: everywhere the
product says "streak" — `StreakFlame`, the reveal count-up, freezes, `streak:sweep`,
"Your {n}-day streak is on the line" — it means the participation streak. Rendering a
tombstone while the flame next to it still burns contradicts the page. The win streak
remains a record stat (`ProfilePublic.win_streak`). If product later wants a
"cold hands" moment for win-streak deaths it is a cheap additive block on the same
pattern, but it is out of scope here.

Known, accepted edges (do not "fix" these without a product decision):

- **The missed wake.** A viewer who picks on their first day back but never opens that
  day's reveal page gets no funeral; by their next reveal the current run no longer
  started "today". The death still appears on the graveyard shelf (SW9-T3). Acceptable.
- **Only the latest death is mourned.** If two runs died between visits (a ≥3 run, then
  a 1-day run), the wake mourns the most recent (the 1-day one, which the
  `OBITUARY_MIN_STREAK` gate then suppresses). Older deaths are graveyard-only.
- **Reveal pages are replayable.** Revisiting the same question's reveal shows the same
  funeral again. Consistent with reveals generally; not a defect.
- **Regrade can resurrect the dead.** A regrade / post-reveal void of the gap day
  un-breaks the run, and `broken_run` (recomputed by replay on every request) goes null.
  That is regrade-consistency working as designed, not a bug.

## 3. The contract change (one primitive, three consumers)

### 3.1 `replayStreak` learns to remember the dead (packages/db)

`StreakReplayResult` gains (additive — existing callers unaffected):

- `runs: Array<{ length: number; startedOn: string; endedOn: string }>` — every
  **completed** (broken) run, in chronological order. Guard both reset sites (the
  `answered`-with-broken-gap branch and the non-participant `broken` branch), but
  **record only when `currentStreak > 0` at the moment of zeroing.** This guard is
  load-bearing, not defensive: in a full-history replay the answered-branch reset is
  provably a no-op (every uncovered gap date got its own earlier non-participant
  iteration that already zeroed the counter — and each *further* missed day re-trips
  `broken` with the counter still at 0, since `lastCountedDate` does not advance on a
  break). Recording unconditionally therefore mints one 0-length garbage "run" per
  missed day, pollutes the graveyard, and — because `runs.length > 0` is the wake
  condition's first-ever-pick exclusion (§3.2) — breaks the trigger itself.
- `currentRunStartedOn: string | null` — the first *counted* (answered) date of the
  live run.

Subtleties the implementation and its tests MUST cover:

- `endedOn` is the run's last **counted** date, which can be a date the profile never
  picked, two ways: the voided-day branch advances `lastCountedDate` over contiguous
  voids, and — equally — a **freeze-covered missed day advances it onto the covered
  date** (the non-participant branch's not-broken arm), so a run that dies the day
  after a freeze bridge has a freeze-covered `endedOn`. The run's "last pick" is
  therefore *the latest answered daily ≤ `endedOn` within the run*, never "the pick on
  `endedOn`". (Tests: a voided-tail run, and a freeze-covered-tail run, each followed by
  a fatal gap.)
- `startedOn` is the first answered date of the run (voided/covered days advance, never
  start).
- **Freeze accounting is half-open: `freezes_survived` = recorded freeze uses with
  `coveredDate` in `(startedOn, endedOn]`.** The tail-covered case above means the
  boundary date belongs to the run. Do NOT model a "freezes burned on the fatal gap"
  class (`coveredDate > endedOn`): it is essentially empty — every covered prefix of a
  would-be-fatal gap is absorbed into the run (advancing `endedOn`), the killing date is
  by definition uncovered, and `streak:sweep` only processes profiles with a positive
  streak, so nothing burns after death.

### 3.2 `viewer.streak.broken_run` (packages/core §6.7 contract-change)

`revealStreakSchema` gains a nullable block. The wake condition (§2), stated
mechanically to leave nothing to interpretation — both values come from the **after**
replay (the one through `question_date`; the before-replay would never satisfy it):

> emit `broken_run` (from `runs.at(-1)`) iff `runs.length > 0 && currentRunStartedOn
> === question_date`

Do not attempt a calendar-adjacency check between the dead run and the live one
("ended the day before the current run started" is *always* false — a death requires ≥1
uncovered revealed day strictly between them). Run-sequence adjacency is automatic:
completed runs and the single live run cannot interleave. The first-ever-pick case is
excluded by `runs.length > 0` — which is exactly why §3.1's zero-guard is load-bearing.
No length threshold server-side — the contract carries the fact; `OBITUARY_MIN_STREAK`
stays a client presentation rule.

```
broken_run: {
  length: number,              // counted days of the dead run
  started_on: string,          // YYYY-MM-DD, first counted date
  ended_on: string,            // YYYY-MM-DD, last counted date (NOT the missed day)
  last_pick: {                 // "Died holding …" — the run's final answered pick
    pick_id: string,           // the viewer's own pick (powers the share path)
    side_label: string,        // that question's label for the held side
    entry_cents: number,       // implied cents for the held side
    question_slug: string,
  } | null,                    // null if unresolvable → UI omits the line (SW4-T1 degrade rule)
  freezes_survived: number,    // recorded freeze uses with coveredDate in (started_on, ended_on] — §3.1
  longest_odds_cents: number | null, // cheapest implied entry among the run's picks; null if none
} | null
```

The builder (`computeViewerStreakBlock`) already fetches everything required: full
`PickRow`s (`getPicksForProfile` — side + `yesPriceAtEntry`), the daily history with
ids/dates, and freeze uses. `last_pick.side_label` needs one extra question fetch by id.
"Hardest day" from the mock's fact list is **not derivable** from any current data —
omitted, and the facts list simply runs short (the card already renders 0–3 facts).

### 3.3 Consumers

1. **Reveal wake** (SW9-T2): `RevealSequence`'s final beat swaps the share button for
   `ObituaryCard` — the exact wiring PR #75 reverted, now keyed off `broken_run`.
2. **Busted-streak card binding** (SW9-T3): `loadReceiptOg`'s current heuristic
   (`loss && profile.currentStreak === 0 && bestStreak >= 1`) is an admitted guess
   (its own SPEC-GAP comment) — with `runs`, the honest binding is "this pick is the
   final answered pick of a completed run", permanent and regrade-consistent.
3. **Graveyard shelf** (SW9-T3): `runs` *is* the `ripDays` data source SW4-T3's
   SPEC-GAP was missing.
4. **The `streak_busted` notification beat** (SW9-T1): `deriveRevealBeats`'s existing
   §13.3 beat ("reset from ≥3") is the *same wake moment*, but keyed off live
   `profiles.current_streak` — so it only fires when the break happens to be applied
   lazily at the reveal walk, and silently never fires in the normal flow where
   `streak:sweep` (03:30 ET) zeroed the profile the day before. §1's post-mortem applies
   to it verbatim. Re-key it onto the same replay-derived wake signal so the
   notification and the payload can never disagree about whether a funeral happened.
   The re-keyed beat DOES apply §13.3's threshold — fire iff the wake condition holds
   AND `runs.at(-1).length >= 3` (`OBITUARY_MIN_STREAK`'s value; §3.2's "no threshold
   server-side" is about the *contract block*, not this beat) — and its narration `n`
   becomes the dead run's length, so notification and obituary card agree on both
   whether and what-sized a funeral happened.

**"Bury it" needs no backend.** The graveyard derives from history, so every dead run is
"archived to the shelf" automatically; burying is acknowledging the funeral, not filing
it. Client-side dismiss (per-mount) is spec-faithful. Do not build persistence for it.

## 4. Tasks (registered as SW9 in the workstream-lock registry)

**SW9-T1 · Broken-run derivation + reveal contract · Depends: —** `[contract-change]`
Spec: this doc §3.1–3.2, §3.3(4); design doc §6.6, §6.7, §13.3.
Deliverables: `replayStreak` `runs`/`currentRunStartedOn` (additive, with the §3.1
zero-guard); `broken_run` on `revealStreakSchema` + §6.7 doc note;
`computeViewerStreakBlock` emission per §3.2's mechanical condition;
`last_pick`/`freezes_survived`/`longest_odds_cents` derivation; `streak_busted`
notification re-keyed onto the same replay signal (§3.3(4)).
AC: integration tests against real Postgres seed — (a) a ≥3-day run + uncovered miss +
first-day-back reveal emits `broken_run` with exact length/dates/last-pick; (b) no gap →
null; (c) freeze-covered gap → null (no death); (d) voided-tail AND freeze-covered-tail
runs resolve `last_pick` to the latest answered date and count the tail freeze in
`freezes_survived` (§3.1); (e) second-day-back reveal → null (fires once); (f) the
falsification case: a loss with an intact streak emits null (`current ≥ 1`, `delta +1` —
the PR #75 shape stays impossible); (g) `runs` never contains a zero-length entry, and N
consecutive missed days record exactly ONE completed run (§3.1 guard); (h)
`streak_busted` fires at the wake even when `streak:sweep` applied the break (the
ordering today's live-field beat misses). Unit tests on the pure replay additions.
Existing replay callers (merge §6.4, regrade) byte-identical on old fields.

**SW9-T2 · The wake: obituary handoff in RevealSequence · Depends: SW9-T1, SW9-T3**
Spec: this doc §2, §3.3(1); plan §2.7 card/tone rules (unchanged).
*(Depends on SW9-T3 because "Share the obituary" routes through the receipt card, and
until T3 re-keys `loadReceiptOg` the death pick — often a WIN — renders a plain receipt,
not a tombstone: the funeral would share the wrong artifact. Land T3 first.)*
Deliverables: final-beat swap to `ObituaryCard` when `broken_run != null && length >=
OBITUARY_MIN_STREAK`; props mapped from the contract (client formats `b./d.` date
labels; facts from `freezes_survived`/`longest_odds_cents` via new `obituaryCopy`
data-slot templates; `causeOfDeath` bound to `last_pick`, line omitted when null);
`Bury it` = client dismiss for the mount; `Share the obituary` opens the existing
`ShareSheet` `kind="receipt"` targeting `last_pick.pick_id`, with `pagePath` =
`/q/${last_pick.question_slug}` — the shared link lands on the death question's page,
whose canonical receipt card is the tombstone (that is what `question_slug` is in the
contract for) — and for the `title` prop the current question's headline (the contract
deliberately carries no death-question headline); fix `ObituaryCard`'s BUSTED stamp to
the §2.7 −7° rotation while touching it.
AC: e2e drives the REAL reveal endpoint against really-seeded history (run + miss +
return), asserts the funeral and that the share sheet opens on the death pick — no
`page.route` mock of the reveal payload anywhere in the trigger test; unit tests for the
copy templates; reduced-motion parity; share button unchanged for all null/short cases.

**SW9-T3 · Honest busted-streak binding + graveyard data · Depends: SW9-T1** `[contract-change]`
Spec: this doc §3.3(2–3); plan §2.7 graveyard block; SW4-T3 entry's empty-state and
ISR-safe ACs stand — its "chips link to the day's question page" AC is **retired** (see
the privacy pin below).
Deliverables: `loadReceiptOg` busted-streak variant re-keyed to the replay binding
(final answered pick of a completed run ≥ `OBITUARY_MIN_STREAK`), obituary layout fed
real run length/dates, hash inputs extended so regrade/void invalidates (§10.5 guard
untouched). **Say-it-out-loud consequence, intended:** a WIN pick that ended a run gets
a tombstone as its canonical share card, permanently — including for already-circulating
links (the `?v=` guard redirects stale hashes to the new render). That is "Died holding
{SIDE} @ {c}¢" working as designed (§2), not only a loss-card false-positive fix.
`ProfilePublic` gains a public `graveyard` block **pinned to run lengths only**:
`{ rip: number[] }` — completed runs ≥ `OBITUARY_MIN_STREAK`, newest-first, cap 12 —
plus the called-it count if cheaply derivable (degrade by omission, SPEC-GAP note).
**Privacy pin (why lengths only, and why the link AC is retired):** per-run dates or
question slugs would make participation on specific dates publicly inferable even where
the picks themselves are `is_public = false` (§9.2 exposes only public picks); bare
lengths leak nothing beyond the already-public streak numbers, and `GraveyardShelf`'s
existing `ripDays: number[]` prop needs nothing more. `/p/[slug]` renders
`GraveyardShelf` from the block (today it is `/dev/ui`-only).
AC: integration test — a pick that ended a ≥3 run renders the obituary card variant
(win-pick case included) and a mid-run loss does NOT (the old heuristic's
false-positive case); profile page stays viewer-free/ISR-cacheable; shelf renders
nothing (not an empty box) when the block is absent; graveyard chips match seeded run
history exactly; no date/slug fields appear in the public block.

## 5. Out of scope

- Win-streak obituaries (§2 decision record).
- "Bury it" persistence (§3.3).
- The "hardest day" fact (not derivable; facts list degrades).
- Any retiming of the reveal choreography (SW3-T2's exclusivity analysis stands).
