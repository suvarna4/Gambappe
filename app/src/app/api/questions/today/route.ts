import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { questions, markets } from "@/db/schema";
import { publicQuestion } from "@/server/serialize";
import { toQuestionRow } from "@/server/question-row";
import { etDateStr } from "@/shared/time";

export async function GET() {
  const today = etDateStr(new Date());
  const [row] = await db
    .select({ q: questions, m: markets })
    .from(questions)
    .innerJoin(markets, eq(questions.marketId, markets.id))
    .where(and(eq(questions.kind, "daily"), eq(questions.questionDate, today)))
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: { code: "not_found", message: "No question today yet." } }, { status: 404 });
  }

  return NextResponse.json({ question: publicQuestion(toQuestionRow(row.q, row.m)) });
}
