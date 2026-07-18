import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { picks, questions } from "@/db/schema";
import { getPrincipal } from "@/server/principal";
import { mePick } from "@/server/serialize";

/** §8.2 GET /api/me/picks — own pick history via mePick. MVP extension: ?questionId= filters to one. */
export async function GET(req: NextRequest) {
  const principal = await getPrincipal(req);
  if (!principal) return NextResponse.json({ picks: [] });

  const questionId = req.nextUrl.searchParams.get("questionId");

  const rows = await db
    .select({ pick: picks, status: questions.status })
    .from(picks)
    .innerJoin(questions, eq(picks.questionId, questions.id))
    .where(
      questionId
        ? and(eq(picks.userId, principal.id), eq(picks.questionId, questionId))
        : eq(picks.userId, principal.id)
    )
    .orderBy(desc(picks.pickedAt))
    .limit(50);

  return NextResponse.json({
    picks: rows.map((r) => mePick(r.pick, r.status)),
  });
}
