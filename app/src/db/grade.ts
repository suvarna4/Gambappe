import { and, eq } from "drizzle-orm";
import { db, type DbOrTx } from "./client";
import { questions, markets, picks, userStats } from "./schema";
import { computeUserStats } from "@/engine/streaks";
import { dailyHistoryForUser, lockSnapshotCounts } from "./queries";
import { etDateTimeToUtc } from "@/shared/time";
import { CONSTANTS } from "@/shared/constants";

/**
 * §5.2 lock transition, reused by the lifecycle sweep (natural lock) and
 * by gradeQuestion's early-settlement path (§5.5 step 2). Writes the
 * IMMUTABLE lock snapshot: price_yes_at_lock + bot-excluded crowd
 * counts. Must run inside the caller's transaction on an already
 * FOR-UPDATE-locked question row.
 */
async function performLock(
  tx: DbOrTx,
  questionId: string,
  marketId: string,
  now: Date
): Promise<void> {
  const [market] = await tx.select().from(markets).where(eq(markets.id, marketId)).limit(1);
  const counts = await lockSnapshotCounts(tx, questionId);
  await tx
    .update(questions)
    .set({
      status: "locked",
      lockedAt: now,
      priceYesAtLock: market?.lastPriceYes ?? null,
      crowdYesAtLock: counts.yes,
      crowdNoAtLock: counts.no,
    })
    .where(eq(questions.id, questionId));
}

/**
 * §5.2 lifecycle: open -> locked at the earliest of locks_at or the
 * market's close_time. Called by the cron sweep for questions still
 * `open` whose deadline has passed. gradeQuestion handles the
 * early-settlement lock path separately (mid-window resolution).
 */
export async function lockDueQuestion(questionId: string, now: Date): Promise<void> {
  await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(questions)
      .where(eq(questions.id, questionId))
      .for("update");
    const q = rows[0];
    if (!q || q.status !== "open") return;
    await performLock(tx, questionId, q.marketId, now);
  });
}

export interface Resolution {
  outcome: "yes" | "no" | "void";
  settledAt: Date;
}

/**
 * §5.5 gradeQuestion — the single idempotent grading transaction.
 * Idempotency is keyed on question STATUS: once the status has moved
 * past open/locked, every call is a safe no-op, so the settlement
 * watcher's at-least-once polling and the admin override can both call
 * this freely.
 */
export async function gradeQuestion(
  questionId: string,
  resolution: Resolution,
  now: Date
): Promise<{ graded: boolean; voided: boolean }> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(questions)
      .where(eq(questions.id, questionId))
      .for("update");
    const q = rows[0];
    if (!q || !["open", "locked"].includes(q.status)) {
      return { graded: false, voided: false };
    }

    // Step 2: early settlement — lock first so no picks land after
    // resolution is known (§5.5 step 2).
    if (q.status === "open") {
      await performLock(tx, questionId, q.marketId, now);
    }

    const [market] = await tx.select().from(markets).where(eq(markets.id, q.marketId)).limit(1);

    if (resolution.outcome === "void") {
      await tx
        .update(markets)
        .set({ status: "voided", settledAt: resolution.settledAt })
        .where(eq(markets.id, q.marketId));
      await tx
        .update(picks)
        .set({ result: "void", settledAt: now })
        .where(eq(picks.questionId, questionId));
      await tx
        .update(questions)
        .set({ status: "voided" })
        .where(eq(questions.id, questionId));
      return { graded: false, voided: true };
    }

    await tx
      .update(markets)
      .set({
        status: "settled",
        outcome: resolution.outcome,
        settledAt: resolution.settledAt,
      })
      .where(eq(markets.id, q.marketId));

    // Grade every pick: result_value = 1 iff pick.side === outcome.
    await tx
      .update(picks)
      .set({ result: "win", settledAt: now })
      .where(and(eq(picks.questionId, questionId), eq(picks.side, resolution.outcome)));
    const losingSide = resolution.outcome === "yes" ? "no" : "yes";
    await tx
      .update(picks)
      .set({ result: "loss", settledAt: now })
      .where(and(eq(picks.questionId, questionId), eq(picks.side, losingSide)));

    const revealAt = computeRevealAt(q.questionDate, now);

    await tx
      .update(questions)
      .set({
        status: "graded",
        gradedAt: now,
        revealAt,
        priceYesAtSettle: market?.lastPriceYes ?? null,
      })
      .where(eq(questions.id, questionId));

    return { graded: true, voided: false };
  });
}

/** D-7: settle early -> grade silently, reveal at 21:00 ET sharp; settle late -> reveal within minutes. */
function computeRevealAt(questionDate: string | null, gradedAt: Date): Date {
  if (!questionDate) return gradedAt; // non-daily questions (unused at MVP): reveal immediately
  const targetEt = etDateTimeToUtc(questionDate, CONSTANTS.REVEAL_TARGET_TIME_ET);
  return targetEt.getTime() > gradedAt.getTime() ? targetEt : gradedAt;
}

/**
 * §5.6 graded -> revealed. Recomputes user_stats for every participant
 * (this is where streak/percentile data first becomes visible — §5.8)
 * then flips the question to revealed. This is the MVP's entire
 * "reveal-fanout" (no separate job/cache to warm, §16.3).
 */
export async function revealQuestion(questionId: string, now: Date): Promise<boolean> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(questions)
      .where(eq(questions.id, questionId))
      .for("update");
    const q = rows[0];
    if (!q || q.status !== "graded") return false;

    const participantRows = await tx
      .selectDistinct({ userId: picks.userId })
      .from(picks)
      .where(eq(picks.questionId, questionId));

    // Flip status first: recomputeUserStatsTx reads history via
    // status IN (revealed, voided) in the SAME transaction, so this
    // question must already read as revealed for its own recompute to
    // include it (read-your-own-writes within the tx).
    await tx
      .update(questions)
      .set({ status: "revealed", revealedAt: now })
      .where(eq(questions.id, questionId));

    for (const { userId } of participantRows) {
      await recomputeUserStatsTx(tx, userId);
    }

    return true;
  });
}

/** Admin "reveal now" override (§16.5): force reveal_at to now, then reveal immediately. */
export async function forceRevealNow(questionId: string, now: Date): Promise<boolean> {
  await db
    .update(questions)
    .set({ revealAt: now })
    .where(and(eq(questions.id, questionId), eq(questions.status, "graded")));
  const ok = await revealQuestion(questionId, now);
  if (ok) {
    const { updateNemesisPairingsOnReveal } = await import("./nemesis");
    await updateNemesisPairingsOnReveal(questionId, now);
  }
  return ok;
}

async function recomputeUserStatsTx(tx: DbOrTx, userId: string): Promise<void> {
  const history = await dailyHistoryForUser(tx, userId);
  const stats = computeUserStats(
    history.map((h) => ({
      questionDate: h.questionDate as string,
      status: h.status as "revealed" | "voided",
      category: h.category,
      // pending never occurs here: dailyHistoryForUser only returns
      // revealed/voided daily questions, whose picks are always graded.
      pickResult: h.pickResult === "pending" ? null : h.pickResult,
      pickEntryPrice: h.pickEntryPrice,
    }))
  );

  await tx
    .insert(userStats)
    .values({
      userId,
      participationStreak: stats.participationStreak,
      bestParticipationStreak: stats.bestParticipationStreak,
      winStreak: stats.winStreak,
      bestWinStreak: stats.bestWinStreak,
      picksTotal: stats.picksTotal,
      picksResolved: stats.picksResolved,
      wins: stats.wins,
      edgeSum: String(stats.edgeSum),
      categoryStats: stats.categoryStats,
      lastDailyPickDate: stats.lastDailyPickDate,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: userStats.userId,
      set: {
        participationStreak: stats.participationStreak,
        bestParticipationStreak: stats.bestParticipationStreak,
        winStreak: stats.winStreak,
        bestWinStreak: stats.bestWinStreak,
        picksTotal: stats.picksTotal,
        picksResolved: stats.picksResolved,
        wins: stats.wins,
        edgeSum: String(stats.edgeSum),
        categoryStats: stats.categoryStats,
        lastDailyPickDate: stats.lastDailyPickDate,
        updatedAt: new Date(),
      },
    });
}

/** Exported for claim-merge (§7.1.3 step 5), which recomputes outside gradeQuestion/revealQuestion. */
export async function recomputeUserStats(userId: string): Promise<void> {
  await db.transaction(async (tx) => recomputeUserStatsTx(tx, userId));
}
