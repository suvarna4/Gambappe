import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/server/admin";
import { runCronTick } from "@/db/lifecycle";

/** §16.5 "tick now" admin button — same sweep as the cron endpoint, admin-authenticated instead of secret header. */
export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return admin.response;
  const result = await runCronTick(new Date());
  return NextResponse.json({ ok: true, ...result });
}
