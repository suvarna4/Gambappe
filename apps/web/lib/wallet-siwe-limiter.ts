/**
 * SIWE nonce/verify rate limiter (design doc §14.1 table row "SIWE nonce/verify | profile |
 * 10/hour (`RL_SIWE_PROFILE_H`)"). Same narrow, single-purpose-limiter posture as
 * `ghost-mint-limiter.ts` — NOT the general-purpose rate-limiter middleware (WS11-T1, built
 * separately). One shared key per profile per hour covers both `/wallet/nonce` and
 * `/wallet/verify`, matching the table's single combined row.
 */
import type { Redis } from 'ioredis';

export interface WalletSiweLimiter {
  /** Increments and returns the post-increment count for `profileId` on `hourKey` (UTC `YYYY-MM-DDTHH`). */
  increment(profileId: string, hourKey: string): Promise<number>;
}

/** Test double — counts are process-local and never expire (fine for short-lived test runs). */
export class InMemoryWalletSiweLimiter implements WalletSiweLimiter {
  private readonly counts = new Map<string, number>();

  async increment(profileId: string, hourKey: string): Promise<number> {
    const key = `${profileId}:${hourKey}`;
    const next = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, next);
    return next;
  }
}

/** `INCR` a per-profile-per-hour key with `EXPIRE` — the real adapter, backed by Redis. */
export class RedisWalletSiweLimiter implements WalletSiweLimiter {
  constructor(private readonly redis: Pick<Redis, 'incr' | 'expire'>) {}

  async increment(profileId: string, hourKey: string): Promise<number> {
    const key = `wallet-siwe:${profileId}:${hourKey}`;
    const count = await this.redis.incr(key);
    if (count === 1) {
      // Bound key lifetime a little past an hour so a slow clock edge can't leave it dangling
      // forever (Redis loss never loses domain data — this is a cache/limiter, §2.2).
      await this.redis.expire(key, 2 * 3600);
    }
    return count;
  }
}

/** UTC hour-bucket key for `at` — the limiter's rolling window boundary. */
export function walletSiweHourKey(at: Date): string {
  return at.toISOString().slice(0, 13); // YYYY-MM-DDTHH
}
