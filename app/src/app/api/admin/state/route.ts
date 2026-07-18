import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { questions, markets, nemesisPairings, users } from "@/db/schema";
import { requireAdmin } from "@/server/admin";

/** §8.4 admin dashboard summary. */
export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return admin.response;

  const questionRows = await db
    .select({ q: questions, m: markets })
    .from(questions)
    .innerJoin(markets, eq(questions.marketId, markets.id))
    .orderBy(desc(questions.createdAt))
    .limit(25);

  const pairingRows = await db.select().from(nemesisPairings).orderBy(desc(nemesisPairings.weekStart)).limit(25);

  const userRows = await db
    .select({ id: users.id, handle: users.handle, kind: users.kind, botSuspect: users.botSuspect, createdAt: users.createdAt })
    .from(users)
    .orderBy(desc(users.createdAt))
    .limit(25);

  return NextResponse.json({
    questions: questionRows.map((r) => ({
      id: r.q.id,
      headline: r.q.headline,
      status: r.q.status,
      questionDate: r.q.questionDate,
      opensAt: r.q.opensAt,
      locksAt: r.q.locksAt,
      revealAt: r.q.revealAt,
      venue: r.m.venue,
      venueMarketId: r.m.venueMarketId,
      venueUrl: r.m.url,
      outcome: r.m.outcome,
    })),
    pairings: pairingRows,
    users: userRows,
  });
}
