/**
 * Next.js-flavored identity resolution adapter (§6.1.1). Split out from `identity.ts` so that
 * file can stay free of any `next-auth`/`../auth.js` import — importing next-auth pulls in
 * `next/server`, which plain vitest can't resolve outside the actual Next.js runtime. Route
 * handlers (which DO run inside Next.js) import `resolveIdentityFromRequest` from here.
 */
import { cookies } from 'next/headers';
import { getProfileById, getProfileByUserId } from '@receipts/db';
import { auth } from '../auth';
import { getDb } from './stores';
import { GHOST_COOKIE_NAME } from './ghost-cookie';
import { resolveIdentity, type Identity, type IdentityLookups, type ResolvedIdentity } from './identity';

function extractCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key === name) {
      // A malformed percent-encoding (e.g. a stray "%") throws URIError — treat exactly like a
      // missing cookie (anonymous), never a 500 (§6.1.1: "never throws on a bad cookie").
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return null;
      }
    }
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

/**
 * Server-component convenience: resolves the viewer's identity from the request cookies via
 * `next/headers` (§6.1.1). Used by viewer-scoped dynamic pages (`/you`, WS22-T1) that can't take a
 * `Request` the way a route handler does. A stale/bad ghost cookie resolves to `anonymous` here —
 * the render can't set cookies, so the clear-on-response step (`clearGhostCookie`) is left to the
 * API routes; only the resolved `Identity` matters for what a page draws.
 */
export async function resolveViewerIdentity(): Promise<Identity> {
  const session = await auth();
  const userId = session?.user?.id;
  const cookieStore = await cookies();
  const ghostCookieValue = cookieStore.get(GHOST_COOKIE_NAME)?.value ?? null;
  const { identity } = await resolveIdentity(
    userId ? { userId } : null,
    ghostCookieValue,
    liveLookups,
  );
  return identity;
}
