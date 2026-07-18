import { eq, desc } from "drizzle-orm";
import { db } from "@/db/client";
import { users, userStats, picks, questions } from "@/db/schema";
import { publicUser, publicPick } from "./serialize";

/**
 * Shared profile lookup used by both GET /api/profiles/{handle} and the
 * /u/{handle} server component. Avoids the self-fetch anti-pattern
 * (hardcoding APP_BASE_URL to call our own API from a server component
 * is a footgun — it breaks whenever the running port doesn't match the
 * configured base URL, e.g. any non-default local port).
 */
export async function getPublicProfile(handle: string) {
  const [user] = await db.select().from(users).where(eq(users.handle, handle)).limit(1);
  if (!user || user.status === "deleted") return null;

  const [stats] = await db.select().from(userStats).where(eq(userStats.userId, user.id)).limit(1);

  const pickRows = await db
    .select({
      side: picks.side,
      entryPrice: picks.entryPrice,
      pickedAt: picks.pickedAt,
      result: picks.result,
      questionStatus: questions.status,
      headline: questions.headline,
      questionId: questions.id,
    })
    .from(picks)
    .innerJoin(questions, eq(picks.questionId, questions.id))
    .where(eq(picks.userId, user.id))
    .orderBy(desc(picks.pickedAt))
    .limit(50);

  interface ProfilePickRow {
    handle: string;
    side: "yes" | "no";
    entryPrice: number;
    pickedAt: string;
    result?: "pending" | "win" | "loss" | "void";
    headline: string;
    questionId: string;
  }

  const pickLog: ProfilePickRow[] = pickRows
    .map((r) => {
      const p = publicPick(
        { handle: user.handle, side: r.side, entryPrice: r.entryPrice, pickedAt: r.pickedAt, result: r.result },
        r.questionStatus
      );
      return p ? ({ ...p, headline: r.headline, questionId: r.questionId } as ProfilePickRow) : null;
    })
    .filter((row): row is ProfilePickRow => row !== null);

  return { profile: publicUser(user, stats ?? null), picks: pickLog };
}
