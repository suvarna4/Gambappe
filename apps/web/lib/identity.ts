/**
 * Identity resolution (design doc §6.1.1): the auth resolution order used on every request.
 *
 *   valid Auth.js session → claimed profile
 *   else valid ghost cookie (id exists, hash matches, status='active') → ghost profile
 *   else anonymous
 *
 * An invalid/stale ghost cookie resolves to anonymous and must be CLEARED on the response —
 * never throw/error for a bad cookie (§6.1.1). This file is intentionally free of any
 * `next-auth`/`../auth.js` import: it only needs plain data in (a resolved session id, a raw
 * cookie value, plain lookup functions), which is what makes it unit-testable with fakes and
 * no Postgres. The Next.js-flavored adapter that actually calls `auth()` lives in
 * `identity-request.ts` — importing next-auth pulls in `next/server`, which plain vitest can't
 * resolve outside the Next.js runtime, so keeping that import out of this file matters.
 */
import type { ProfileRow } from '@receipts/db';
import { parseGhostCookieValue, verifyGhostSecret } from './ghost-cookie';

export type Identity =
  | { kind: 'anonymous' }
  | { kind: 'ghost'; profile: ProfileRow }
  | { kind: 'claimed'; profile: ProfileRow; userId: string };

export interface ResolvedIdentity {
  identity: Identity;
  /** True when a bad ghost cookie was presented and the response must clear it (§6.1.1). */
  clearGhostCookie: boolean;
}

export interface IdentityLookups {
  getProfileByUserId: (userId: string) => Promise<ProfileRow | null>;
  getProfileById: (id: string) => Promise<ProfileRow | null>;
}

/** Pure core: no DB client, no Next.js — just the resolution algorithm (§6.1.1). */
export async function resolveIdentity(
  session: { userId: string } | null,
  ghostCookieValue: string | null | undefined,
  lookups: IdentityLookups,
): Promise<ResolvedIdentity> {
  if (session) {
    const profile = await lookups.getProfileByUserId(session.userId);
    if (profile && profile.kind === 'claimed' && profile.status !== 'deleted') {
      return { identity: { kind: 'claimed', profile, userId: session.userId }, clearGhostCookie: false };
    }
    // Valid session but no (usable) claimed profile yet: falls through to ghost/anonymous
    // resolution below — `/claim` itself reads the session directly for its case A–D logic
    // (it needs to know "no profile yet" distinctly from "anonymous").
  }

  const parsed = parseGhostCookieValue(ghostCookieValue);
  if (!parsed) {
    // Missing cookie → nothing to clear. Present-but-malformed cookie → clear it.
    return { identity: { kind: 'anonymous' }, clearGhostCookie: Boolean(ghostCookieValue) };
  }

  const profile = await lookups.getProfileById(parsed.profileId);
  const valid =
    profile !== null &&
    profile.kind === 'ghost' &&
    profile.status === 'active' &&
    profile.ghostSecretHash !== null &&
    verifyGhostSecret(parsed.secret, profile.ghostSecretHash);

  if (!valid) {
    return { identity: { kind: 'anonymous' }, clearGhostCookie: true };
  }

  return { identity: { kind: 'ghost', profile: profile! }, clearGhostCookie: false };
}
