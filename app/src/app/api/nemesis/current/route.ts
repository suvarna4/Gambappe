import { NextRequest, NextResponse } from "next/server";
import { eq, or } from "drizzle-orm";
import { db } from "@/db/client";
import { nemesisPairings } from "@/db/schema";
import { getPrincipal } from "@/server/principal";

/** §8.2 GET /api/nemesis/current — own active (or most recent) pairing id. */
export async function GET(req: NextRequest) {
  const principal = await getPrincipal(req);
  if (!principal || principal.kind !== "claimed") {
    return NextResponse.json({ pairing: null });
  }

  const rows = await db
    .select()
    .from(nemesisPairings)
    .where(or(eq(nemesisPairings.userA, principal.id), eq(nemesisPairings.userB, principal.id)));

  const active = rows.find((r) => r.status === "active");
  const mostRecent = active ?? rows[rows.length - 1];

  return NextResponse.json({ pairing: mostRecent ? { id: mostRecent.id, status: mostRecent.status } : null });
}
