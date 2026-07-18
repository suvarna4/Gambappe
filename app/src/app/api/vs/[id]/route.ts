import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { nemesisPairings, nemesisMatchQuestions, questions, users, picks } from "@/db/schema";
import { publicUser } from "@/server/serialize";
import { narrateCurrentBeat, type NemesisNarrationContext } from "@/engine/narration/narration";
import { CONSTANTS } from "@/shared/constants";

/** §8.2 GET /api/vs/{pairingId} — public matchup page data (post-lock questions only, all match questions qualify by construction). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [pairing] = await db.select().from(nemesisPairings).where(eq(nemesisPairings.id, id)).limit(1);
  if (!pairing) {
    return NextResponse.json({ error: { code: "not_found", message: "Matchup not found" } }, { status: 404 });
  }

  const [userA] = await db.select().from(users).where(eq(users.id, pairing.userA)).limit(1);
  const [userB] = await db.select().from(users).where(eq(users.id, pairing.userB)).limit(1);

  const matchQuestions = await db
    .select({ questionId: nemesisMatchQuestions.questionId })
    .from(nemesisMatchQuestions)
    .where(eq(nemesisMatchQuestions.pairingId, id));

  const questionRows = [];
  for (const { questionId } of matchQuestions) {
    const [q] = await db.select().from(questions).where(eq(questions.id, questionId)).limit(1);
    const rows = await db.select().from(picks).where(eq(picks.questionId, questionId));
    const pA = rows.find((r) => r.userId === pairing.userA);
    const pB = rows.find((r) => r.userId === pairing.userB);
    questionRows.push({
      headline: q?.headline,
      pickA: pA ? { side: pA.side, entryPrice: Number(pA.entryPrice), result: pA.result } : null,
      pickB: pB ? { side: pB.side, entryPrice: Number(pB.entryPrice), result: pB.result } : null,
    });
  }

  const ctx: NemesisNarrationContext = {
    pairingId: pairing.id,
    handleA: userA?.handle ?? "?",
    handleB: userB?.handle ?? "?",
    scoreA: pairing.scoreA,
    scoreB: pairing.scoreB,
    questionsRemaining: Math.max(0, CONSTANTS.NEMESIS_MATCH_QUESTIONS - matchQuestions.length),
  };
  const winnerHandle =
    pairing.winner === "a" ? ctx.handleA : pairing.winner === "b" ? ctx.handleB : undefined;
  const loserHandle =
    pairing.winner === "a" ? ctx.handleB : pairing.winner === "b" ? ctx.handleA : undefined;
  const narration = narrateCurrentBeat(
    ctx,
    pairing.status === "completed" ? "completed" : "active",
    winnerHandle,
    loserHandle
  );

  return NextResponse.json({
    pairing: {
      id: pairing.id,
      userA: userA ? publicUser(userA, null) : null,
      userB: userB ? publicUser(userB, null) : null,
      weekStart: pairing.weekStart,
      status: pairing.status,
      scoreA: pairing.scoreA,
      scoreB: pairing.scoreB,
      winner: pairing.winner,
      questions: questionRows,
      narration,
    },
  });
}
