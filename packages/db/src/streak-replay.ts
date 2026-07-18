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

export interface StreakReplayResult {
  currentStreak: number;
  bestStreak: number;
  lastCountedDate: string | null;
  currentWinStreak: number;
  bestWinStreak: number;
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
        if (broken) currentStreak = 0;
      }
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
      if (broken) currentStreak = 0;
      else lastCountedDate = q.questionDate;
    }
    // lastCountedDate === null and no pick: profile never started a streak; nothing to do.
  }

  return { currentStreak, bestStreak, lastCountedDate, currentWinStreak, bestWinStreak };
}
