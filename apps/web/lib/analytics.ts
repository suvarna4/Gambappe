/**
 * IP/UA hashing for analytics_events (design doc §5.6, §13.1, WS13-T1).
 *
 * The salt is a per-day random value that lives only in Redis and is discarded at
 * rotation — never derived from a persisted secret, so an IPv4-space brute force must be
 * impossible once the day ends (§5.6). Raw IP/UA are never persisted; only the hash.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';
import { logger } from './logger';
import { ensureRedisConnected } from './stores';

const SALT_TTL_SECONDS = 60 * 60 * 48; // 2 days — safety margin past the UTC day rotation

export function dailySaltDateKey(at: Date): string {
  return at.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

function saltRedisKey(dateKey: string): string {
  return `analytics:ip-salt:${dateKey}`;
}

/** Pure — never touches raw values in storage, only ever returns a digest. */
export function hashWithSalt(value: string, salt: string): string {
  return createHash('sha256').update(`${salt}:${value}`).digest('hex');
}

/** Get today's salt, minting one on first use. Safe under concurrent first-callers (NX). */
export async function getDailySalt(redis: Redis, dateKey: string): Promise<string> {
  await ensureRedisConnected(redis);
  const key = saltRedisKey(dateKey);
  const existing = await redis.get(key);
  if (existing) return existing;

  const candidate = randomBytes(32).toString('hex');
  const set = await redis.set(key, candidate, 'EX', SALT_TTL_SECONDS, 'NX');
  if (set === 'OK') return candidate;

  // Another request minted it between our GET and SET — use their winning value.
  const winner = await redis.get(key);
  if (winner) return winner;
  throw new Error(`getDailySalt: no salt present for ${dateKey} after NX race`);
}

/** First entry of a (possibly multi-hop) X-Forwarded-For, else null. No raw value is ever stored. */
export function extractClientIp(headers: Headers): string | null {
  const forwardedFor = headers.get('x-forwarded-for');
  if (forwardedFor) {
    const first = forwardedFor.split(',')[0]?.trim();
    if (first) return first;
  }
  const realIp = headers.get('x-real-ip');
  return realIp?.trim() || null;
}

export function extractUserAgent(headers: Headers): string | null {
  return headers.get('user-agent')?.trim() || null;
}

export interface RequestMetaHashes {
  ipHash: string | null;
  uaHash: string | null;
}

/**
 * Best-effort: if Redis is unreachable, returns nulls rather than throwing — analytics
 * ingestion is fire-and-forget (§13.1) and must not fail the request over a hashing salt.
 */
export async function hashRequestMeta(
  headers: Headers,
  redis: Redis,
  at: Date = new Date(),
): Promise<RequestMetaHashes> {
  const ip = extractClientIp(headers);
  const ua = extractUserAgent(headers);
  if (!ip && !ua) return { ipHash: null, uaHash: null };

  try {
    const salt = await getDailySalt(redis, dailySaltDateKey(at));
    return {
      ipHash: ip ? hashWithSalt(ip, salt) : null,
      uaHash: ua ? hashWithSalt(ua, salt) : null,
    };
  } catch (err) {
    logger.warn({ err }, 'hashRequestMeta: falling back to null hashes (salt unavailable)');
    return { ipHash: null, uaHash: null };
  }
}
