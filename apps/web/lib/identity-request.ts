/**
 * Next.js-flavored identity resolution adapter (§6.1.1). Split out from `identity.ts` so that
 * file can stay free of any `next-auth`/`../auth.js` import — importing next-auth pulls in
 * `next/server`, which plain vitest can't resolve outside the actual Next.js runtime. Route
 * handlers (which DO run inside Next.js) import `resolveIdentityFromRequest` from here.
 */
import { getProfileById, getProfileByUserId } from '@receipts/db';
import { auth } from '../auth';
import { getDb } from './stores';
import { GHOST_COOKIE_NAME } from './ghost-cookie';
import { resolveIdentity, type IdentityLookups, type ResolvedIdentity } from './identity';

function extractCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

const liveLookups: IdentityLookups = {
  getProfileByUserId: (userId) => getProfileByUserId(getDb(), userId),
  getProfileById: (id) => getProfileById(getDb(), id),
};

/** Route-handler convenience: resolves identity for an incoming `Request` (§9.1). */
export async function resolveIdentityFromRequest(request: Request): Promise<ResolvedIdentity> {
  const session = await auth();
  const userId = session?.user?.id;
  const ghostCookieValue = extractCookie(request.headers.get('cookie'), GHOST_COOKIE_NAME);
  return resolveIdentity(userId ? { userId } : null, ghostCookieValue, liveLookups);
}
