/**
 * Ghost mint service (design doc §6.1.1). This builds the mint FUNCTION itself; actually
 * invoking it lazily on first mutating action (first pick/reaction/placement-answer) is WS3's
 * job (§6.1.1: "minted lazily on the first mutating action ... never on page view").
 *
 * Mint = insert a `profiles` row (`kind='ghost'`, generated handle) + return the cookie value
 * for the caller to set (`ghost-cookie.ts` owns the Set-Cookie flags/options).
 *
 * The core `mintGhost` takes plain functions (not a `Db`) so the rate-limit/handle-generation
 * orchestration is unit-testable with fakes; `mintGhostWithDb` is the thin `@receipts/db`-backed
 * wrapper route handlers actually call.
 */
import { uuidv7 } from 'uuidv7';
import { ApiError, GHOST_MINT_PER_IP_PER_DAY, now } from '@receipts/core';
import { handleExists, insertProfile, type Db, type NewProfileRow, type ProfileRow } from '@receipts/db';
import { generateHandle } from './handle-generator';
import { buildGhostCookieValue, generateGhostSecret, hashGhostSecret } from './ghost-cookie';
import { ghostMintDayKey, type GhostMintLimiter } from './ghost-mint-limiter';

export interface MintGhostResult {
  profile: ProfileRow;
  /** Value for the `rcpt_gid` cookie (`<profileId>.<secret>`); pair with `ghostCookieOptions()`. */
  cookieValue: string;
}

export interface MintGhostDeps {
  handleExists: (handle: string) => Promise<boolean>;
  insertProfile: (row: NewProfileRow) => Promise<ProfileRow>;
}

/**
 * Seconds from `at` until the next UTC midnight — when the per-IP-per-day mint bucket
 * (keyed by `ghostMintDayKey`, a UTC calendar date) rolls over. Never less than 1.
 */
export function ghostMintRetryAfterSeconds(at: Date): number {
  const nextUtcMidnightMs = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() + 1);
  return Math.max(1, Math.ceil((nextUtcMidnightMs - at.getTime()) / 1000));
}

/**
 * Mints a ghost profile for `ip`, enforcing `GHOST_MINT_PER_IP_PER_DAY` via `limiter`.
 * Over limit → `ApiError('RATE_LIMITED', ...)` (§6.1.1: "over limit → still allow the pick? No")
 * carrying `retry_after_seconds` in details so `jsonError` can set the `Retry-After` header the
 * §14.1 contract requires on every 429 (audit 2.5).
 */
export async function mintGhost(
  deps: MintGhostDeps,
  ip: string,
  limiter: GhostMintLimiter,
  at: Date = now(),
): Promise<MintGhostResult> {
  const count = await limiter.increment(ip, ghostMintDayKey(at));
  if (count > GHOST_MINT_PER_IP_PER_DAY) {
    throw new ApiError('RATE_LIMITED', 'ghost mint limit exceeded for this IP today', {
      retry_after_seconds: ghostMintRetryAfterSeconds(at),
    });
  }

  const { handle, slug } = await generateHandle({ handleExists: deps.handleExists });
  const secret = generateGhostSecret();

  const profile = await deps.insertProfile({
    id: uuidv7(),
    kind: 'ghost',
    status: 'active',
    handle,
    slug,
    handleIsGenerated: true,
    ghostSecretHash: hashGhostSecret(secret),
    lastSeenAt: at,
    settings: {},
  });

  return { profile, cookieValue: buildGhostCookieValue(profile.id, secret) };
}

/** `@receipts/db`-backed convenience wrapper for route handlers. */
export async function mintGhostWithDb(
  db: Db,
  ip: string,
  limiter: GhostMintLimiter,
  at: Date = now(),
): Promise<MintGhostResult> {
  return mintGhost(
    { handleExists: (h) => handleExists(db, h), insertProfile: (row) => insertProfile(db, row) },
    ip,
    limiter,
    at,
  );
}
