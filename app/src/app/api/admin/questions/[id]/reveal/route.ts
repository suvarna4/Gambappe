import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/server/admin";
import { forceRevealNow } from "@/db/grade";

/** §16.5 "reveal now": sets reveal_at = now and reveals immediately (demo pacing). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return admin.response;
  const { id } = await params;
  const ok = await forceRevealNow(id, new Date());
  return NextResponse.json({ ok });
}
