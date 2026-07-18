import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { oauthStates } from "@/db/schema";
import { completeOAuthIdentity } from "@/server/claim";
import { SESSION_COOKIE_NAME, SESSION_COOKIE_OPTIONS } from "@/server/principal";
import { isGoogleConfigured } from "@/server/google-oauth";

const bodySchema = z.object({ state: z.string(), email: z.string().email() });

/**
 * Dev-only stand-in for the Google consent screen (no AUTH_GOOGLE_ID
 * configured). Never reachable when Google is configured — this is an
 * MVP demo/dev convenience, not a production auth path.
 */
export async function POST(req: NextRequest) {
  if (isGoogleConfigured()) {
    return NextResponse.json({ error: { code: "disabled", message: "Google OAuth is configured; use the real flow." } }, { status: 403 });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "invalid_body", message: "state and email required" } }, { status: 400 });
  }

  const [stateRow] = await db.select().from(oauthStates).where(eq(oauthStates.state, parsed.data.state)).limit(1);
  if (!stateRow) {
    return NextResponse.json({ error: { code: "bad_state", message: "Claim session expired, try again." } }, { status: 400 });
  }
  await db.delete(oauthStates).where(eq(oauthStates.state, parsed.data.state));

  const outcome = await completeOAuthIdentity(stateRow.ghostUserId!, parsed.data.email);
  if (outcome.kind === "existing_account_dead_end") {
    return NextResponse.json({ redirect: "/claim/already-exists" });
  }

  const res = NextResponse.json({ redirect: "/claim" });
  res.cookies.set(SESSION_COOKIE_NAME, outcome.sessionToken, SESSION_COOKIE_OPTIONS);
  return res;
}
