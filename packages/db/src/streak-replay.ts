/**
 * Streak replay (design doc §6.6 "Replay procedure"): rebuild a profile's participation/win
 * streak fields from scratch by replaying all revealed/voided daily questions in
 * `question_date` order against its (post-merge, post-regrade, ...) pick history, honoring
 * `streak_freeze_uses` as the recorded ground truth for freeze coverage — freeze consumption
 * is NEVER re-simulated here, only replayed exactly as already recorded (§6.6).
 *
 * Pure function: no DB, no clock reads — plain data in, plain data out, so it is unit-testable
 * without Postgres. Built by WS2-T3 as the MINIMAL version needed for merge correctness
 * (§6.4 step 4); WS3-T3 (streak sweep / freeze-grant jobs, regrade, post-reveal void) may
 * extend or relocate this — it is intentionally kept generic (takes already-fetched arrays)
 * so those later call sites can reuse it as-is.
 */

export interface ReplayDailyQuestion {
  id: string;
  questionDate: string; // YYYY-MM-DD
  status: 'revealed' | 'voided';
}

export interface ReplayPick {
  questionId: string;
  result: 'pending' | 'win' | 'loss' | 'void';
}

export interface ReplayFreezeUse {
  coveredDate: string; // YYYY-MM-DD
}

/** One COMPLETED (broken) participation run (SW9-T1, obituary-handoff §3.1). */
export interface CompletedStreakRun {
  /** Counted days — always >= 1 (the §3.1 zero-guard forbids zero-length entries). */
  length: number;
  /** First answered date of the run (voided/freeze-covered days advance, never start). */
  startedOn: string; // YYYY-MM-DD
  /**
   * Last COUNTED date of the run — can be a date the profile never picked (a contiguous voided
   * day, or a freeze-covered missed day, both of which advance `lastCountedDate` onto
   * themselves). NEVER the missed day that killed the run. Consumers wanting the run's "last
   * pick" must resolve the latest ANSWERED date <= `endedOn` within the run, not `endedOn`.
   */
  endedOn: string; // YYYY-MM-DD
}

export interface StreakReplayResult {
  currentStreak: number;
  bestStreak: number;
  lastCountedDate: string | null;
  currentWinStreak: number;
  bestWinStreak: number;
  /**
   * Every completed (broken) run, in chronological order (SW9-T1, obituary-handoff §3.1 —
   * additive; pre-SW9 callers ignore it). Recorded at both reset sites, but ONLY when the
   * counter is actually positive at the moment of zeroing — see the guard comments inline.
   */
  runs: CompletedStreakRun[];
  /**
   * First counted (ANSWERED) date of the live run, or null when `currentStreak === 0`
   * (obituary-handoff §3.1). `runs.length > 0 && currentRunStartedOn === <reveal's
   * question_date>` is the §3.2 wake condition.
   */
  currentRunStartedOn: string | null;
}

function isImmediateNextDay(prev: string, next: string): boolean {
  const p = new Date(`${prev}T00:00:00Z`);
  const n = new Date(`${next}T00:00:00Z`);
  return n.getTime() - p.getTime() === 24 * 3600_000;
}

/**
 * Replays `dailyQuestions` (revealed or voided only — callers must exclude
 * draft/scheduled/open/locked, which are not settled history) in date order against `picks`
 * (this profile's picks, any question) and `freezeUses` (this profile's recorded freeze
 * coverage). `freeze_bank` itself is left as-is by design (§6.4 step 4) — only the derived
 * streak fields are returned.
 */
export function replayStreak(
  dailyQuestions: ReplayDailyQuestion[],
  picks: ReplayPick[],
  freezeUses: ReplayFreezeUse[],
): StreakReplayResult {
  const sorted = [...dailyQuestions].sort((a, b) => a.questionDate.localeCompare(b.questionDate));
  const revealedDates = sorted
    .filter((q) => q.status === 'revealed')
    .map((q) => q.questionDate);
  const freezeCovered = new Set(freezeUses.map((f) => f.coveredDate));
  const pickByQuestionId = new Map(picks.map((p) => [p.questionId, p] as const));

  let currentStreak = 0;
  let bestStreak = 0;
  let lastCountedDate: string | null = null;
  let currentWinStreak = 0;
  let bestWinStreak = 0;
  const runs: CompletedStreakRun[] = [];
  let currentRunStartedOn: string | null = null;

  /**
   * Called at BOTH reset sites (obituary-handoff §3.1). The `currentStreak > 0` guard is
   * load-bearing, not defensive: in a full-history replay every uncovered gap date gets its own
   * non-participant iteration that zeroes the counter first (and each FURTHER missed day
   * re-trips `broken` with the counter still 0, since `lastCountedDate` never advances on a
   * break) — recording unconditionally would mint one zero-length garbage "run" per missed day
   * and, because `runs.length > 0` is the §3.2 wake condition's first-ever-pick exclusion,
   * break the trigger itself. N consecutive missed days must record exactly ONE run.
   */
  const recordBrokenRun = () => {
    if (currentStreak > 0) {
      // A positive counter implies both anchors exist: the run's first increment set
      // `currentRunStartedOn`, and every increment/advance set `lastCountedDate`.
      runs.push({ length: currentStreak, startedOn: currentRunStartedOn!, endedOn: lastCountedDate! });
    }
    currentRunStartedOn = null;
  };

  /** Revealed (non-void) dates strictly between two bounds — the §6.6 "one gap rule" walk set. */
  const revealedBetween = (fromExclusive: string, toDate: string, inclusiveEnd: boolean) =>
    revealedDates.filter((d) => d > fromExclusive && (inclusiveEnd ? d <= toDate : d < toDate));

  for (const q of sorted) {
    if (q.status === 'voided') {
      // §6.6 "Voided day D": advances last_counted_date only when directly contiguous with the
      // current run; otherwise a pre-existing gap is left for the next revealed day's walk
      // (void days are excluded from that walk's date set — "skipped entirely").
      if (lastCountedDate !== null && isImmediateNextDay(lastCountedDate, q.questionDate)) {
        lastCountedDate = q.questionDate;
      }
      continue;
    }

    const pick = pickByQuestionId.get(q.id);
    const answered = pick !== undefined && pick.result !== 'void';

    if (answered) {
      if (lastCountedDate !== null) {
        const gap = revealedBetween(lastCountedDate, q.questionDate, false);
        const broken = gap.some((d) => !freezeCovered.has(d));
        if (broken) {
          recordBrokenRun(); // §3.1 zero-guard inside — a full-history replay no-ops here
          currentStreak = 0;
        }
      }
      if (currentStreak === 0) currentRunStartedOn = q.questionDate; // first ANSWERED date of the run
      currentStreak += 1;
      lastCountedDate = q.questionDate;
      bestStreak = Math.max(bestStreak, currentStreak);
      if (pick!.result === 'win') currentWinStreak += 1;
      else if (pick!.result === 'loss') currentWinStreak = 0;
      bestWinStreak = Math.max(bestWinStreak, currentWinStreak);
    } else if (lastCountedDate !== null) {
      // Non-participant on a real (revealed) daily — mirrors `streak:sweep`: only advances
      // (freeze-covered) or breaks; never increments (no actual participation).
      const throughToday = revealedBetween(lastCountedDate, q.questionDate, true);
      const broken = throughToday.some((d) => !freezeCovered.has(d));
      if (broken) {
        recordBrokenRun(); // §3.1 zero-guard inside — later missed days of the same gap no-op
        currentStreak = 0;
      } else {
        lastCountedDate = q.questionDate; // freeze-covered: the covered date JOINS the run (§3.1)
      }
    }
    // lastCountedDate === null and no pick: profile never started a streak; nothing to do.
  }

  return { currentStreak, bestStreak, lastCountedDate, currentWinStreak, bestWinStreak, runs, currentRunStartedOn };
}

// --- Forward gap-rule decision (WS3-T3: reveal-time increment + streak:sweep) ------------------
//
// `replayStreak` above RECONSTRUCTS streak fields from already-recorded `streak_freeze_uses`
// ground truth (merge, regrade, post-reveal void). The forward-processing paths (a daily's
// `reveal:fire` incrementing its participants, and `streak:sweep` advancing/breaking
// non-participants) instead have to DECIDE new freeze consumption for the first time, then
// persist it. `decideGapFreezeConsumption` is the one place that decision is made — it reuses
// the exact same "revealed (non-void) dates strictly between two bounds" window `replayStreak`
// computes internally (re-derived here as `revealedDatesBetween`, not duplicated ad hoc), so
// both call sites (§6.6 "the one gap rule") walk identical date sets. Callers persist
// `newFreezeUses`/`freezeBankAfter`, then call `replayStreak` (with those now-recorded uses) to
// get the resulting canonical `current_streak`/`best_streak`/`last_counted_date` — so the
// ONLY new logic here is "what gets covered," never "what the resulting streak length is."

/** All revealed (non-void) `question_date`s in `dailyQuestions`, ascending. */
export function revealedDatesAscending(dailyQuestions: ReplayDailyQuestion[]): string[] {
  return dailyQuestions
    .filter((q) => q.status === 'revealed')
    .map((q) => q.questionDate)
    .sort();
}

/**
 * Revealed (non-void) dates strictly after `fromExclusive` (or all of them, if `fromExclusive`
 * is null — no prior streak to bridge, per §6.6) and, per `inclusiveEnd`, up to-and-including or
 * strictly-before `toDate`.
 */
export function revealedDatesBetween(
  dailyQuestions: ReplayDailyQuestion[],
  fromExclusive: string | null,
  toDate: string,
  inclusiveEnd: boolean,
): string[] {
  if (fromExclusive === null) return [];
  return revealedDatesAscending(dailyQuestions).filter(
    (d) => d > fromExclusive && (inclusiveEnd ? d <= toDate : d < toDate),
  );
}

export interface GapDecisionInput {
  /** Revealed/voided daily history up to (at least) `throughDate`. */
  dailyQuestions: ReplayDailyQuestion[];
  /** This profile's picks (any question — matched by id against `dailyQuestions`). */
  picks: ReplayPick[];
  /** Already-recorded freeze coverage for this profile. */
  existingFreezeUses: ReplayFreezeUse[];
  lastCountedDate: string | null;
  throughDate: string;
  /** true (streak:sweep, non-participant D) includes `throughDate` in the walk; false
   * (reveal:fire, participant D) excludes it — D itself always increments separately. */
  includeThroughDate: boolean;
  freezeBankBefore: number;
}

export interface GapDecisionResult {
  /** Dates newly covered by a freeze this call, in walk order (persist as `streak_freeze_uses`). */
  newFreezeUses: string[];
  freezeBankAfter: number;
  /** True iff the walk hit an uncovered miss (informational — `replayStreak` derives the actual
   * resulting streak length once `newFreezeUses` is persisted and re-replayed). */
  broken: boolean;
}

/**
 * §6.6 "the one gap rule," forward decision form: walks revealed gap dates in order; a date
 * already covered (recorded freeze use, or the profile actually answered it — defensive, should
 * not occur given the structural daily-processing-order guarantee, §6.6) is skipped; otherwise
 * consumes a freeze if `freeze_bank > 0`, else stops (the remainder of the walk is left
 * uncovered — `replayStreak` will see that as a break).
 */
export function decideGapFreezeConsumption(input: GapDecisionInput): GapDecisionResult {
  const { dailyQuestions, picks, existingFreezeUses, lastCountedDate, throughDate, includeThroughDate, freezeBankBefore } =
    input;
  if (lastCountedDate === null) {
    return { newFreezeUses: [], freezeBankAfter: freezeBankBefore, broken: false };
  }

  const gapDates = revealedDatesBetween(dailyQuestions, lastCountedDate, throughDate, includeThroughDate);
  const covered = new Set(existingFreezeUses.map((f) => f.coveredDate));
  const dailyByDate = new Map(dailyQuestions.map((q) => [q.questionDate, q] as const));
  const pickByQuestionId = new Map(picks.map((p) => [p.questionId, p] as const));

  let freezeBank = freezeBankBefore;
  const newFreezeUses: string[] = [];
  let broken = false;

  for (const date of gapDates) {
    if (covered.has(date)) continue;
    const daily = dailyByDate.get(date);
    const pick = daily ? pickByQuestionId.get(daily.id) : undefined;
    if (pick && pick.result !== 'void') continue; // defensive: already actually answered

    if (freezeBank > 0) {
      freezeBank -= 1;
      newFreezeUses.push(date);
    } else {
      broken = true;
      break;
    }
  }

  return { newFreezeUses, freezeBankAfter: freezeBank, broken };
}
