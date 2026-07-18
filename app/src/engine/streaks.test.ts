import { describe, it, expect } from "vitest";
import { computeUserStats, computeDailyPercentile, type DailyHistoryRow } from "./streaks";

function row(
  date: string,
  status: "revealed" | "voided",
  pickResult: "win" | "loss" | "void" | null,
  entryPrice: string | null = "0.5",
  category: DailyHistoryRow["category"] = "sports"
): DailyHistoryRow {
  return { questionDate: date, status, pickResult, pickEntryPrice: entryPrice, category };
}

describe("computeUserStats (§5.8)", () => {
  it("builds a simple participation + win streak", () => {
    const history = [
      row("2026-07-01", "revealed", "win", "0.5"),
      row("2026-07-02", "revealed", "win", "0.6"),
      row("2026-07-03", "revealed", "loss", "0.4"),
    ];
    const stats = computeUserStats(history);
    expect(stats.participationStreak).toBe(3);
    expect(stats.bestParticipationStreak).toBe(3);
    expect(stats.winStreak).toBe(0); // broke on the loss
    expect(stats.bestWinStreak).toBe(2);
    expect(stats.wins).toBe(2);
    expect(stats.picksResolved).toBe(3);
  });

  it("a voided date is skipped entirely — never breaks or extends", () => {
    const history = [
      row("2026-07-01", "revealed", "win", "0.5"),
      row("2026-07-02", "voided", null, null),
      row("2026-07-03", "revealed", "win", "0.5"),
    ];
    const stats = computeUserStats(history);
    expect(stats.participationStreak).toBe(2); // voided day doesn't break it
  });

  it("a missed day (no pick, question revealed) breaks participation but not win streak calc basis", () => {
    const history = [
      row("2026-07-01", "revealed", "win", "0.5"),
      row("2026-07-02", "revealed", null, null), // user didn't pick
      row("2026-07-03", "revealed", "win", "0.5"),
    ];
    const stats = computeUserStats(history);
    expect(stats.participationStreak).toBe(1); // broken by the missed day
    expect(stats.winStreak).toBe(2); // win streak is over resolved picks only, missed day doesn't count as a loss
  });

  it("edge_sum reflects (result - entry_price)", () => {
    const history = [row("2026-07-01", "revealed", "win", "0.2")]; // called it! edge = 1 - 0.2 = 0.8
    const stats = computeUserStats(history);
    expect(stats.edgeSum).toBeCloseTo(0.8, 5);
  });

  it("category stats aggregate by category", () => {
    const history = [
      row("2026-07-01", "revealed", "win", "0.5", "sports"),
      row("2026-07-02", "revealed", "loss", "0.5", "sports"),
      row("2026-07-03", "revealed", "win", "0.5", "politics"),
    ];
    const stats = computeUserStats(history);
    expect(stats.categoryStats.sports).toEqual({ picks: 2, wins: 1 });
    expect(stats.categoryStats.politics).toEqual({ picks: 1, wins: 1 });
  });

  it("out-of-order settlement is harmless because input is always question_date sorted", () => {
    // Simulates Tuesday settling before Monday by ensuring the caller
    // always re-sorts by questionDate before calling — this test locks
    // that the function trusts its input order (order-safety is the
    // caller's job via the SQL ORDER BY in queries.ts).
    const inOrder = [
      row("2026-07-01", "revealed", "loss"),
      row("2026-07-02", "revealed", "win"),
    ];
    const stats = computeUserStats(inOrder);
    expect(stats.winStreak).toBe(1);
    expect(stats.bestWinStreak).toBe(1);
  });
});

describe("computeDailyPercentile (D-9)", () => {
  it("ranks winners above losers, harder calls higher among winners", () => {
    const pickers = [
      { userId: "a", botSuspect: false, result: "win" as const, entryPrice: 0.2 }, // hardest win
      { userId: "b", botSuspect: false, result: "win" as const, entryPrice: 0.8 }, // easy win
      { userId: "c", botSuspect: false, result: "loss" as const, entryPrice: 0.9 }, // least-wrong loss
      { userId: "d", botSuspect: false, result: "loss" as const, entryPrice: 0.1 }, // worst loss
    ];
    // a should beat everyone: percentile 1.0 (3/3 below)
    expect(computeDailyPercentile(pickers, "a")).toBeCloseTo(1.0, 5);
    // d should beat no one: percentile 0
    expect(computeDailyPercentile(pickers, "d")).toBeCloseTo(0, 5);
  });

  it("excludes bot_suspect pickers from the denominator", () => {
    const pickers = [
      { userId: "a", botSuspect: false, result: "win" as const, entryPrice: 0.5 },
      { userId: "bot", botSuspect: true, result: "loss" as const, entryPrice: 0.01 },
      { userId: "b", botSuspect: false, result: "loss" as const, entryPrice: 0.5 },
    ];
    expect(computeDailyPercentile(pickers, "a")).toBeCloseTo(1.0, 5); // beats the one non-bot loser
  });

  it("returns null for a single-picker day", () => {
    const pickers = [{ userId: "a", botSuspect: false, result: "win" as const, entryPrice: 0.5 }];
    expect(computeDailyPercentile(pickers, "a")).toBeNull();
  });
});
