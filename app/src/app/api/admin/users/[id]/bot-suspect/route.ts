import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { requireAdmin } from "@/server/admin";

const bodySchema = z.object({ botSuspect: z.boolean() });

/** §7.15/§8.4 bot-suspect review toggle. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return admin.response;
  const { id } = await params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "invalid_body", message: "botSuspect boolean required" } }, { status: 400 });
  }
  await db.update(users).set({ botSuspect: parsed.data.botSuspect }).where(eq(users.id, id));
  return NextResponse.json({ ok: true });
}
