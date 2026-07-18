import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { questions, markets, questionParticipants } from "@/db/schema";
import { publicQuestion } from "@/server/serialize";
import { toQuestionRow } from "@/server/question-row";
import { getPrincipal } from "@/server/principal";

/** §8.2: 404 for placement (recorded outcomes); nemesis_bonus/duo are participant-only pre-lock. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [row] = await db
    .select({ q: questions, m: markets })
    .from(questions)
    .innerJoin(markets, eq(questions.marketId, markets.id))
    .where(eq(questions.id, id))
    .limit(1);

  if (!row || row.q.kind === "placement") {
    return NextResponse.json({ error: { code: "not_found", message: "Question not found" } }, { status: 404 });
  }

  const prelocked = !["locked", "graded", "revealed", "voided"].includes(row.q.status);
  if ((row.q.kind === "nemesis_bonus" || row.q.kind === "duo") && prelocked) {
    const principal = await getPrincipal(req);
    const isMember =
      principal &&
      (await db
        .select()
        .from(questionParticipants)
        .where(eq(questionParticipants.questionId, id))
        .then((rows) => rows.some((r) => r.userId === principal.id)));
    if (!isMember) {
      return NextResponse.json({ error: { code: "not_found", message: "Question not found" } }, { status: 404 });
    }
  }

  return NextResponse.json({ question: publicQuestion(toQuestionRow(row.q, row.m)) });
}
