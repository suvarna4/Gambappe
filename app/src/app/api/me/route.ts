import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users, userStats } from "@/db/schema";
import { getPrincipal } from "@/server/principal";
import { meUser } from "@/server/serialize";
import { resolvedCompetitivePicks } from "@/db/queries";

export async function GET(req: NextRequest) {
  const principal = await getPrincipal(req);
  if (!principal) return NextResponse.json({ user: null });

  const [user] = await db.select().from(users).where(eq(users.id, principal.id)).limit(1);
  if (!user) return NextResponse.json({ user: null });

  const [stats] = await db.select().from(userStats).where(eq(userStats.userId, principal.id)).limit(1);
  const resolved = await resolvedCompetitivePicks(db, principal.id);

  return NextResponse.json({
    user: meUser(user, stats ?? null, resolved.length),
  });
}
