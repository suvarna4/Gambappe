import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { questions, picks, users, userStats, markets } from "@/db/schema";
import { getPrincipal } from "@/server/principal";
import { computeDailyPercentile } from "@/engine/streaks";

/** §5.6/§8.2: personal reveal payload — 404 until the question is revealed. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ questionId: string }> }) {
  const principal = await getPrincipal(req);
  if (!principal) return NextResponse.json({ error: { code: "unauthorized", message: "No session" } }, { status: 401 });

  const { questionId } = await params;
  const [question] = await db.select().from(questions).where(eq(questions.id, questionId)).limit(1);
  if (!question || question.status !== "revealed") {
    return NextResponse.json({ error: { code: "not_found", message: "Not revealed yet" } }, { status: 404 });
  }

  const [myPick] = await db
    .select()
    .from(picks)
    .where(eq(picks.questionId, questionId))
    .then((rows) => rows.filter((r) => r.userId === principal.id));
  if (!myPick) {
    return NextResponse.json({ error: { code: "not_found", message: "You didn't pick this one" } }, { status: 404 });
  }

  const allPickers = await db
    .select({ userId: picks.userId, result: picks.result, entryPrice: picks.entryPrice, botSuspect: users.botSuspect })
    .from(picks)
    .innerJoin(users, eq(picks.userId, users.id))
    .where(eq(picks.questionId, questionId));

  const percentile = computeDailyPercentile(
    allPickers
      .filter((p) => p.result === "win" || p.result === "loss")
      .map((p) => ({
        userId: p.userId,
        botSuspect: p.botSuspect,
        result: p.result as "win" | "loss",
        entryPrice: Number(p.entryPrice),
      })),
    principal.id
  );

  const [stats] = await db.select().from(userStats).where(eq(userStats.userId, principal.id)).limit(1);
  const [market] = await db.select().from(markets).where(eq(markets.id, question.marketId)).limit(1);

  return NextResponse.json({
    reveal: {
      questionId,
      side: myPick.side,
      entryPrice: Number(myPick.entryPrice),
      result: myPick.result,
      outcome: market?.outcome ?? null,
      crowdYesAtLock: question.crowdYesAtLock,
      crowdNoAtLock: question.crowdNoAtLock,
      percentile,
      participationStreak: stats?.participationStreak ?? 0,
      winStreak: stats?.winStreak ?? 0,
    },
  });
}
