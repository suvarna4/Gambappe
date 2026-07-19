/**
 * §6.2 step 2: "Resolve identity; if anonymous, mint ghost (§6.1.1) inside the same request."
 * The only route that needs this lazy-mint behavior in this wave — general `ghost+`/`claimed`
 * routes just call `resolveIdentityFromRequest` and treat anonymous as `UNAUTHENTICATED`.
 */
import type { NextResponse } from 'next/server';
import { now } from '@receipts/core';
import type { ProfileRow } from '@receipts/db';
import { getDb, getRedis } from './stores';
import { GHOST_COOKIE_NAME, clearedGhostCookieOptions, ghostCookieOptions } from './ghost-cookie';
import { RedisGhostMintLimiter } from './ghost-mint-limiter';
import { mintGhostWithDb } from './ghost-mint';
import { clientIpKey } from './rate-limit';
import { resolveIdentityFromRequest } from './identity-request';

export interface ResolvedOrMintedIdentity {
  profile: ProfileRow;
  /** True when this call minted a brand-new ghost — caller must set the cookie on the response. */
  minted: boolean;
  cookieValue?: string;
  clearGhostCookie: boolean;
}

export async function resolveOrMintIdentity(request: Request): Promise<ResolvedOrMintedIdentity> {
  const { identity, clearGhostCookie } = await resolveIdentityFromRequest(request);

  if (identity.kind !== 'anonymous') {
    return { profile: identity.profile, minted: false, clearGhostCookie };
  }

  const limiter = new RedisGhostMintLimiter(getRedis());
  // Missing-IP policy: one shared fail-closed bucket — see `clientIpKey` (audit 2.6).
  const ip = clientIpKey(request.headers);
  const { profile, cookieValue } = await mintGhostWithDb(getDb(), ip, limiter, now());
  return { profile, minted: true, cookieValue, clearGhostCookie };
}

/** Applies the mint/clear cookie side effects from `resolveOrMintIdentity` onto a response. */
export function applyIdentityCookies(response: NextResponse, resolved: ResolvedOrMintedIdentity): void {
  if (resolved.minted && resolved.cookieValue) {
    response.cookies.set(GHOST_COOKIE_NAME, resolved.cookieValue, ghostCookieOptions());
  } else if (resolved.clearGhostCookie) {
    response.cookies.set(GHOST_COOKIE_NAME, '', clearedGhostCookieOptions());
  }
}
