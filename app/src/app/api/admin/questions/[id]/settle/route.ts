import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { adminAudit, questions } from "@/db/schema";
import { requireAdmin } from "@/server/admin";
import { gradeQuestion } from "@/db/grade";
import { getPrincipal } from "@/server/principal";

const bodySchema = z.object({ outcome: z.enum(["yes", "no", "void"]) });

/**
 * §5.5 manual override: the ONE resolution source, feeding the same
 * gradeQuestion pipeline the automated watcher uses. Grading, stats,
 * and reveal scheduling all work identically either way.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return admin.response;
  const { id } = await params;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "invalid_body", message: "outcome must be yes/no/void" } }, { status: 400 });
  }

  const principal = await getPrincipal(req);
  const now = new Date();
  const result = await gradeQuestion(id, { outcome: parsed.data.outcome, settledAt: now }, now);

  await db.insert(adminAudit).values({
    actor: principal?.handle ?? "admin",
    action: "manual_settle",
    subject: { questionId: id, outcome: parsed.data.outcome },
  });
  console.info(`[admin] manual settlement: question=${id} outcome=${parsed.data.outcome}`);

  const [q] = await db.select().from(questions).where(eq(questions.id, id)).limit(1);
  return NextResponse.json({ result, question: q });
}
