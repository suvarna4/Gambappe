/**
 * Claim flow (design doc §6.3): cases A–D + the shared-device "this isn't me" guard + the
 * INV-9 attestation gate. Kept independent of the HTTP layer (takes a `Db` + plain input, no
 * `Request`/`NextResponse`) so it's directly unit/integration-testable; `claim/route.ts` is a
 * thin adapter around this.
 */
import { uuidv7 } from 'uuidv7';
import { ApiError, now } from '@receipts/core';
import {
  getProfileById,
  getProfileByUserId,
  getUserById,
  handleExists,
  insertProfile,
  mergeGhostIntoProfile,
  setUserAgeAttested,
  updateProfileById,
  type Db,
  type ProfileRow,
} from '@receipts/db';
import { generateHandle } from './handle-generator';
import { parseGhostCookieValue, verifyGhostSecret } from './ghost-cookie';

export type ClaimCase = 'A' | 'B' | 'C' | 'D';

export interface ClaimInput {
  userId: string;
  ghostCookieValue: string | null | undefined;
  ageAttested?: true;
  /** Shared-device guard (§6.3): "This isn't me" — disclaim the ghost cookie, run case B/D. */
  notMe?: true;
}

export interface ClaimOutput {
  profile: ProfileRow;
  case: ClaimCase;
  clearGhostCookie: boolean;
}

async function resolveGhostForClaim(
  db: Db,
  cookieValue: string | null | undefined,
): Promise<ProfileRow | null> {
  const parsed = parseGhostCookieValue(cookieValue);
  if (!parsed) return null;
  const profile = await getProfileById(db, parsed.profileId);
  if (!profile || profile.kind !== 'ghost' || profile.status !== 'active' || !profile.ghostSecretHash) {
    return null;
  }
  if (!verifyGhostSecret(parsed.secret, profile.ghostSecretHash)) return null;
  return profile;
}

export async function runClaim(db: Db, input: ClaimInput): Promise<ClaimOutput> {
  const at = now();
  const user = await getUserById(db, input.userId);
  if (!user) throw new ApiError('UNAUTHENTICATED', 'no such user');

  // INV-9: required before claim completes.
  if (user.ageAttestedAt === null) {
    if (input.ageAttested !== true) {
      throw new ApiError('AGE_ATTESTATION_REQUIRED', 'age attestation required to claim (INV-9)');
    }
    await setUserAgeAttested(db, input.userId, at);
  }

  const cookiePresent = Boolean(input.ghostCookieValue);
  const rawGhost = input.notMe ? null : await resolveGhostForClaim(db, input.ghostCookieValue);
  // Clear whenever a cookie was presented but didn't resolve to a usable ghost — either it was
  // invalid/stale, or the caller explicitly disclaimed it via `not_me` (§6.3 shared-device guard).
  const clearInvalidOrDisclaimed = cookiePresent && rawGhost === null;

  const existingProfile = await getProfileByUserId(db, input.userId);

  if (existingProfile) {
    if (rawGhost) {
      // Case C: merge ghost G into the existing profile P (§6.4).
      await mergeGhostIntoProfile(db, rawGhost.id, existingProfile.id, at);
      const merged = await getProfileById(db, existingProfile.id);
      if (!merged) throw new Error('runClaim: merged profile disappeared mid-transaction');
      return { profile: merged, case: 'C', clearGhostCookie: true };
    }
    // Case D: no-op.
    return { profile: existingProfile, case: 'D', clearGhostCookie: clearInvalidOrDisclaimed };
  }

  if (rawGhost) {
    // Case A: transition the ghost row in place (DD-4 — history retained by construction).
    const claimed = await updateProfileById(db, rawGhost.id, {
      kind: 'claimed',
      userId: input.userId,
      claimedAt: at,
      ghostSecretHash: null,
      ageAttestedAt: at,
    });
    return { profile: claimed, case: 'A', clearGhostCookie: true };
  }

  // Case B: fresh claimed profile with a generated handle.
  const { handle, slug } = await generateHandle({ handleExists: (h) => handleExists(db, h) });
  const created = await insertProfile(db, {
    id: uuidv7(),
    kind: 'claimed',
    status: 'active',
    handle,
    slug,
    handleIsGenerated: true,
    userId: input.userId,
    claimedAt: at,
    lastSeenAt: at,
    ageAttestedAt: at,
    settings: {},
  });
  return { profile: created, case: 'B', clearGhostCookie: clearInvalidOrDisclaimed };
}
