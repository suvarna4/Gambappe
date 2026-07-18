/**
 * Ghost cookie primitives (design doc §6.1.1). Cookie `rcpt_gid`: value `<profileId>.<secret>`
 * where secret = 32 random bytes base64url. The server stores only
 * `HMAC-SHA256(secret, GHOST_COOKIE_SECRET)` in `profiles.ghost_secret_hash` — ONE pinned
 * scheme, never plain SHA-256. `GHOST_COOKIE_SECRET` is effectively NON-ROTATABLE (rotating it
 * logs out every ghost, Appendix B / `.env.example`) — never rotate casually.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { isUuid } from '@receipts/core';

export const GHOST_COOKIE_NAME = 'rcpt_gid';
/** 400 days (§6.1.1). */
export const GHOST_COOKIE_MAX_AGE_S = 34_560_000;

function ghostCookieSecretKey(): string {
  const key = process.env.GHOST_COOKIE_SECRET;
  if (!key) throw new Error('GHOST_COOKIE_SECRET is not set (see .env.example)');
  return key;
}

/** 32 random bytes, base64url — the per-cookie secret half (never persisted in plaintext). */
export function generateGhostSecret(): string {
  return randomBytes(32).toString('base64url');
}

/** `HMAC-SHA256(secret, GHOST_COOKIE_SECRET)`, hex — the ONLY value persisted at rest. */
export function hashGhostSecret(secret: string): string {
  return createHmac('sha256', ghostCookieSecretKey()).update(secret).digest('hex');
}

/** Constant-time comparison against the stored hash — never `===` on secrets/hashes. */
export function verifyGhostSecret(secret: string, storedHash: string): boolean {
  const computed = Buffer.from(hashGhostSecret(secret), 'hex');
  const stored = Buffer.from(storedHash, 'hex');
  if (computed.length !== stored.length) return false;
  return timingSafeEqual(computed, stored);
}

export function buildGhostCookieValue(profileId: string, secret: string): string {
  return `${profileId}.${secret}`;
}

export interface ParsedGhostCookie {
  profileId: string;
  secret: string;
}

/** Never throws — a malformed cookie parses to `null` (§6.1.1: invalid cookie → anonymous). */
export function parseGhostCookieValue(value: string | undefined | null): ParsedGhostCookie | null {
  if (!value) return null;
  const dot = value.indexOf('.');
  if (dot <= 0 || dot === value.length - 1) return null;
  const profileId = value.slice(0, dot);
  const secret = value.slice(dot + 1);
  if (!isUuid(profileId) || secret.length === 0) return null;
  return { profileId, secret };
}

/** `Set-Cookie` options for minting/refreshing a ghost cookie (§6.1.1 flags). */
export function ghostCookieOptions(): {
  httpOnly: true;
  secure: true;
  sameSite: 'lax';
  path: '/';
  maxAge: number;
} {
  return { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: GHOST_COOKIE_MAX_AGE_S };
}

/** `Set-Cookie` options to clear an invalid/stale ghost cookie (§6.1.1: clear, never error). */
export function clearedGhostCookieOptions(): {
  httpOnly: true;
  secure: true;
  sameSite: 'lax';
  path: '/';
  maxAge: 0;
} {
  return { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0 };
}
