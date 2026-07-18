import { and, eq, inArray, sql } from "drizzle-orm";
import type { DbOrTx } from "./client";
import { picks, questions, markets, users } from "./schema";

type Db = DbOrTx;

/**
 * D-18: the ONE sanctioned way to fetch a user's resolved competitive
 * picks. MVP scope only ever produces kind='daily' questions, so this
 * simplifies to daily-only, but the filter is written as the full design
 * intends (kind IN (...)) so it grows forward without rework.
 */
export async function resolvedCompetitivePicks(db: Db, userId: string) {
  return db
    .select({
      pickId: picks.id,
      side: picks.side,
      entryPrice: picks.entryPrice,
      result: picks.result,
      pickedAt: picks.pickedAt,
      questionId: questions.id,
      questionDate: questions.questionDate,
      questionKind: questions.kind,
      opensAt: questions.opensAt,
      locksAt: questions.locksAt,
      category: markets.category,
    })
    .from(picks)
    .innerJoin(questions, eq(picks.questionId, questions.id))
    .innerJoin(markets, eq(questions.marketId, markets.id))
    .where(
      and(
        eq(picks.userId, userId),
        inArray(questions.kind, ["daily", "nemesis_bonus", "duo"]),
        inArray(picks.result, ["win", "loss"])
      )
    )
    .orderBy(questions.questionDate, questions.opensAt);
}

/** All completed (revealed or voided) daily questions in date order, with this user's pick (if any). */
export async function dailyHistoryForUser(db: Db, userId: string) {
  return db
    .select({
      questionId: questions.id,
      questionDate: questions.questionDate,
      status: questions.status,
      category: markets.category,
      pickResult: picks.result,
      pickSide: picks.side,
      pickEntryPrice: picks.entryPrice,
    })
    .from(questions)
    .innerJoin(markets, eq(questions.marketId, markets.id))
    .leftJoin(
      picks,
      and(eq(picks.questionId, questions.id), eq(picks.userId, userId))
    )
    .where(
      and(eq(questions.kind, "daily"), inArray(questions.status, ["revealed", "voided"]))
    )
    .orderBy(questions.questionDate);
}

export async function lockSnapshotCounts(db: Db, questionId: string) {
  const rows = await db
    .select({ side: picks.side, count: sql<number>`count(*)::int` })
    .from(picks)
    .innerJoin(users, eq(picks.userId, users.id))
    .where(and(eq(picks.questionId, questionId), eq(users.botSuspect, false)))
    .groupBy(picks.side);
  const yes = rows.find((r) => r.side === "yes")?.count ?? 0;
  const no = rows.find((r) => r.side === "no")?.count ?? 0;
  return { yes, no };
}
