import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/server/admin";
import { assignNemeses } from "@/db/nemesis";

/** §16.5: admin-triggered nemesis assignment (not a weekly cron at MVP scope). */
export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return admin.response;
  const pairings = await assignNemeses(new Date());
  return NextResponse.json({ pairings });
}
