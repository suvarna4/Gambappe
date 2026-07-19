# Settlement dispute

For a question whose venue resolution is late, wrong, or overturned after reveal (§10.3, §15.3).
See [`launch-drill.md`](launch-drill.md) §4 for the full rollback-procedure table this runbook
summarizes, and `docs/audits/question-zero-drill-log.md` for a live-tested run of the post-reveal
void path specifically.

- **Late resolution:** use force-settle (`POST /api/admin/questions/:id/settle`, WS10-T3) only
  after `FORCE_SETTLE_MIN_AFTER_CLOSE_MIN` (30 min) past the venue market's close time, and only
  when the real-world outcome is independently confirmed. Requires typing the outcome — no
  one-click "just pick one."
- **Wrong resolution pre-reveal, or a question needs pulling before it locks/reveals:** void
  with a reason (`PATCH /api/admin/questions/:id/void`). Streak-neutral by construction — every
  affected profile is treated as having answered that day, no increment, no break (§6.5/§6.6
  "Voided day D").
- **Resolution overturned after our reveal** (e.g. a UMA dispute): the same void route's
  post-reveal path, available within `REGRADE_WINDOW_H` (48h) of reveal. **Read the caveat
  below before running this against a profile with a real streak** — it is not the same
  streak-neutral guarantee as a pre-reveal void.
- **Outcome right but graded wrong:** regrade (`POST /api/admin/questions/:id/regrade`) within
  48h. If Glicko ratings were already applied for the affected weekly period, this requires the
  "deep regrade" path — pre-application rating snapshots are restored for every participant of
  that period and the whole period is re-run together (Glicko-2 doesn't support reversing a
  single game in isolation).

All three actions (force-settle, void, regrade) enqueue the standard `grade:followup` +
streak-replay pipeline — there's no separate manual pick-fixing path.

## Post-reveal void streak caveat (confirmed via drill)

A post-reveal void doesn't just "undo today" for streak purposes — it triggers a full **replay**
of every affected profile's streak from scratch (`packages/db/src/streak-replay.ts`), based on
all of that profile's *other* revealed-non-void dailies. In the drill, three fresh ghost profiles
whose *only* daily ever was the one just voided landed back at `current_streak=0` after the void
— correct, since replay excludes the voided day entirely and they had no other history to fall
back on. That is a materially different outcome than the pre-reveal void guarantee ("treated as
answered, streak preserved") — a pre-reveal void never had anything to unwind, since streak
mutation only ever happens at reveal or later (§6.6). A post-reveal void, by contrast, is
unwinding an increment that already landed.

**Before running a post-reveal void against a profile with a real, meaningful prior streak**
(not drilled here — would need ≥2 days of seeded history to observe), read `replayStreak()`'s
contiguous-day-advance logic in `packages/db/src/streak-replay.ts` and consider whether the
replay could also affect *other* days around the voided one (a freeze-covered gap, a
subsequently-broken chain) before treating it as a routine, side-effect-free correction. Given
`REGRADE_WINDOW_H` is 48h, this scenario is realistic within Question Zero's own first two days
if a real venue dispute happens early.
