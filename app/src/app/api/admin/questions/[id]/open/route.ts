import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { questions } from "@/db/schema";
import { requireAdmin } from "@/server/admin";

/** §16.5: manual open button so the demo never waits for a clock. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return admin.response;
  const { id } = await params;
  await db.update(questions).set({ status: "open" }).where(eq(questions.id, id));
  return NextResponse.json({ ok: true });
}
