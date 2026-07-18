import { CONSTANTS } from "@/shared/constants";
import type { Category } from "@/shared/constants";

export interface DailyHistoryRow {
  questionDate: string; // YYYY-MM-DD
  status: "revealed" | "voided";
  category: Category;
  pickResult: "win" | "loss" | "void" | null;
  pickEntryPrice: string | null; // numeric as string from pg
}

export interface UserStatsResult {
  participationStreak: number;
  bestParticipationStreak: number;
  winStreak: number;
  bestWinStreak: number;
  picksTotal: number;
  picksResolved: number;
  wins: number;
  edgeSum: number;
  categoryStats: Record<string, { picks: number; wins: number }>;
  lastDailyPickDate: string | null;
}

/**
 * §5.8 pure recompute: takes the user's full daily-question history
 * (ordered by question_date ASC, revealed + voided questions only —
 * open/locked/graded questions never appear here, D-16/§5.6 secrecy) and
 * derives every user_stats field from scratch. Idempotent and
 * order-safe by construction (design-doc §4.4, §5.5 step 4).
 *
 * - Voided questions "do not exist" (D-5): skipped entirely.
 * - Participation streak = consecutive completed daily dates with a pick.
 * - Win streak = consecutive wins over the sequence of the user's own
 *   resolved picks (missed days don't break it — it isn't calendar-based).
 */
export function computeUserStats(history: DailyHistoryRow[]): UserStatsResult {
  let participationStreak = 0;
  let bestParticipationStreak = 0;
  let winStreak = 0;
  let bestWinStreak = 0;
  let picksTotal = 0;
  let picksResolved = 0;
  let wins = 0;
  let edgeSum = 0;
  let lastDailyPickDate: string | null = null;
  const categoryStats: Record<string, { picks: number; wins: number }> = {};

  for (const row of history) {
    if (row.status === "voided") continue; // D-5: does not exist

    const participated = row.pickResult !== null && row.pickResult !== "void";
    if (participated) {
      participationStreak += 1;
      lastDailyPickDate = row.questionDate;
    } else {
      participationStreak = 0;
    }
    bestParticipationStreak = Math.max(bestParticipationStreak, participationStreak);

    if (!participated) continue;

    picksTotal += 1;
    picksResolved += 1;
    const won = row.pickResult === "win";
    if (won) wins += 1;
    winStreak = won ? winStreak + 1 : 0;
    bestWinStreak = Math.max(bestWinStreak, winStreak);

    const entryPrice = Number(row.pickEntryPrice ?? 0);
    edgeSum += (won ? 1 : 0) - entryPrice;

    const cs = categoryStats[row.category] ?? { picks: 0, wins: 0 };
    cs.picks += 1;
    if (won) cs.wins += 1;
    categoryStats[row.category] = cs;
  }

  return {
    participationStreak,
    bestParticipationStreak,
    winStreak,
    bestWinStreak,
    picksTotal,
    picksResolved,
    wins,
    edgeSum,
    categoryStats,
    lastDailyPickDate,
  };
}

export interface PercentileInput {
  userId: string;
  botSuspect: boolean;
  result: "win" | "loss";
  entryPrice: number;
}

/**
 * D-9: "You beat X% of today's pickers." Winners rank above losers;
 * within winners, lower entry price ranks higher (harder call); within
 * losers, higher entry price ranks higher (least-wrong first).
 * Bot-suspect pickers are excluded entirely (§7.15).
 */
export function computeDailyPercentile(
  pickers: PercentileInput[],
  userId: string
): number | null {
  const pool = pickers.filter((p) => !p.botSuspect);
  const me = pool.find((p) => p.userId === userId);
  if (!me || pool.length < 2) return null;

  const rank = (p: PercentileInput): number => {
    // Higher rankScore = ranked higher (better). D-9: winners above
    // losers; among winners lower entry price ranks higher (harder
    // call); among losers higher entry price ranks higher (least-wrong).
    if (p.result === "win") return 2 - p.entryPrice; // range [1,2), lower price -> higher
    return p.entryPrice; // range [0,1], higher price -> higher
  };

  const myScore = rank(me);
  const below = pool.filter((p) => rank(p) < myScore).length;
  return below / (pool.length - 1);
}

export const NEMESIS_RATING_BAND = CONSTANTS.NEMESIS_RATING_BAND;
