/**
 * Ghost-mint rate limiter (design doc §6.1.1, §14.1 table row "Ghost mint | IP | 10/day").
 * This is a narrow, ghost-mint-specific limiter — NOT the general-purpose rate-limiter
 * middleware (WS11-T1, built separately/in parallel). Behind a small interface so the
 * counting/threshold logic is unit-testable with an in-memory fake; the Redis-backed adapter
 * is exercised by CI integration tests only (no Redis available in this sandbox).
 */
import type { Redis } from 'ioredis';

export interface GhostMintLimiter {
  /** Increments and returns the post-increment count for `ip` on `dayKey` (UTC `YYYY-MM-DD`). */
  increment(ip: string, dayKey: string): Promise<number>;
}

/** Test double — counts are process-local and never expire (fine for short-lived test runs). */
export class InMemoryGhostMintLimiter implements GhostMintLimiter {
  private readonly counts = new Map<string, number>();

  async increment(ip: string, dayKey: string): Promise<number> {
    const key = `${ip}:${dayKey}`;
    const next = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, next);
    return next;
  }
}

/** `INCR` a per-IP-per-day key with `EXPIRE` (§6.1.1) — the real adapter, backed by Redis. */
export class RedisGhostMintLimiter implements GhostMintLimiter {
  constructor(private readonly redis: Pick<Redis, 'incr' | 'expire'>) {}

  async increment(ip: string, dayKey: string): Promise<number> {
    const key = `ghost-mint:${ip}:${dayKey}`;
    const count = await this.redis.incr(key);
    if (count === 1) {
      // First increment of the day for this IP: bound key lifetime a little past a day so a
      // slow clock/timezone edge can't leave it dangling forever (Redis loss never loses
      // domain data — this is a cache/limiter, §2.2).
      await this.redis.expire(key, 26 * 3600);
    }
    return count;
  }
}

/** UTC calendar day key for `at` — the limiter's rolling window boundary. */
export function ghostMintDayKey(at: Date): string {
  return at.toISOString().slice(0, 10);
}
