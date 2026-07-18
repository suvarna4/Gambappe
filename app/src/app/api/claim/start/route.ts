import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { oauthStates } from "@/db/schema";
import { getPrincipal, mintGhost, GHOST_COOKIE_NAME, GHOST_COOKIE_OPTIONS } from "@/server/principal";
import { randomToken } from "@/server/crypto";
import { googleAuthUrl, isGoogleConfigured } from "@/server/google-oauth";

/** §7.1.3 step 1: begin claim. Mints a ghost first if the visitor came in cold (direct signup). */
export async function GET(req: NextRequest) {
  let principal = await getPrincipal(req);
  let ghostCookieValue: string | null = null;
  if (!principal) {
    const minted = await mintGhost(req);
    if ("rateLimited" in minted) {
      return NextResponse.redirect(new URL("/?claimError=rate_limited", req.url));
    }
    principal = minted.principal;
    ghostCookieValue = minted.cookieValue;
  }

  const state = randomToken(16);
  await db.insert(oauthStates).values({ state, ghostUserId: principal.id });

  const target = isGoogleConfigured()
    ? googleAuthUrl(state)
    : `/claim/dev-signin?state=${encodeURIComponent(state)}`;

  const res = NextResponse.redirect(new URL(target, req.url));
  if (ghostCookieValue) res.cookies.set(GHOST_COOKIE_NAME, ghostCookieValue, GHOST_COOKIE_OPTIONS);
  return res;
}
