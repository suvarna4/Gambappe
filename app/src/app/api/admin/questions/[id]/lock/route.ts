import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/server/admin";
import { lockDueQuestion } from "@/db/grade";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return admin.response;
  const { id } = await params;
  await lockDueQuestion(id, new Date());
  return NextResponse.json({ ok: true });
}
