import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { oauthStates } from "@/db/schema";
import { exchangeCodeForEmail } from "@/server/google-oauth";
import { completeOAuthIdentity } from "@/server/claim";
import { SESSION_COOKIE_NAME, SESSION_COOKIE_OPTIONS } from "@/server/principal";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  if (!code || !state) {
    return NextResponse.redirect(new URL("/?claimError=missing_params", req.url));
  }

  const [stateRow] = await db.select().from(oauthStates).where(eq(oauthStates.state, state)).limit(1);
  if (!stateRow) {
    return NextResponse.redirect(new URL("/?claimError=bad_state", req.url));
  }
  await db.delete(oauthStates).where(eq(oauthStates.state, state));

  const email = await exchangeCodeForEmail(code);
  if (!email) {
    return NextResponse.redirect(new URL("/?claimError=oauth_failed", req.url));
  }

  const outcome = await completeOAuthIdentity(stateRow.ghostUserId!, email);
  if (outcome.kind === "existing_account_dead_end") {
    return NextResponse.redirect(new URL("/claim/already-exists", req.url));
  }

  const res = NextResponse.redirect(new URL("/claim", req.url));
  res.cookies.set(SESSION_COOKIE_NAME, outcome.sessionToken, SESSION_COOKIE_OPTIONS);
  return res;
}
