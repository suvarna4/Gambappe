import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { getPrincipal } from "@/server/principal";
import { track } from "@/server/events";

const bodySchema = z.object({ ageAttested: z.literal(true), publicnessAck: z.literal(true) });

/**
 * §7.1.3 step 3 / INV-12: promotes pending -> claimed. This is the one
 * route a pending session may call (besides GET /api/me and sign-out) —
 * the pending state exists precisely so this call is reachable without
 * a chicken-and-egg session problem.
 */
export async function POST(req: NextRequest) {
  const principal = await getPrincipal(req);
  if (!principal || principal.kind !== "pending") {
    return NextResponse.json({ error: { code: "claim_incomplete", message: "No pending claim to attest." } }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "invalid_body", message: "18+ attestation and publicness acknowledgement are both required." } },
      { status: 400 }
    );
  }

  const now = new Date();
  await db
    .update(users)
    .set({ kind: "claimed", claimedAt: now, ageAttestedAt: now })
    .where(eq(users.id, principal.id));

  await track("claim_completed", principal.id, {});

  return NextResponse.json({ ok: true });
}
