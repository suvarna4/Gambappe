/**
 * WS19-T2 · Server-component identity resolution (§6.1.1) for viewer-scoped pages like `/sweat`.
 *
 * Route handlers resolve identity from an incoming `Request` (`identity-request.ts`); a Server
 * Component has no `Request` in hand, so this reads the same two inputs the request adapter reads
 * — the Auth.js session (`auth()`) and the ghost cookie (`next/headers`' `cookies()`) — and runs
 * them through the SAME pure `resolveIdentity` algorithm. This never MINTS a ghost (a GET page
 * render must stay side-effect-free — minting writes a row and needs to set a cookie on the
 * response, which a Server Component can't do; `/sweat`'s empty state covers the anonymous
 * visitor). A stale/bad ghost cookie simply resolves to anonymous here (§6.1.1: never throw); the
 * clear-cookie side effect is left to the next route handler the browser hits.
 */
import { cookies } from 'next/headers';
import { getProfileById, getProfileByUserId } from '@receipts/db';
import { auth } from '../auth';
import { getDb } from './stores';
import { GHOST_COOKIE_NAME } from './ghost-cookie';
import { resolveIdentity, type Identity, type IdentityLookups } from './identity';

/**
 * Resolves the current viewer to a claimed profile (valid session), a ghost profile (valid ghost
 * cookie), or `{ kind: 'anonymous' }`. Read-only: no mint, no cookie writes.
 */
export async function resolveViewerIdentity(): Promise<Identity> {
  const session = await auth();
  const userId = session?.user?.id;
  const cookieStore = await cookies();
  const ghostCookieValue = cookieStore.get(GHOST_COOKIE_NAME)?.value ?? null;

  const db = getDb();
  const lookups: IdentityLookups = {
    getProfileByUserId: (id) => getProfileByUserId(db, id),
    getProfileById: (id) => getProfileById(db, id),
  };

  const { identity } = await resolveIdentity(userId ? { userId } : null, ghostCookieValue, lookups);
  return identity;
}
