/**
 * WS11-T1 integration: the Redis token bucket against a real Redis, plus the fail-closed
 * in-process fallback when Redis is unreachable (§14.1).
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import { checkRateLimit } from '../../lib/rate-limit';

const redisUrl = process.env.REDIS_URL ?? process.env.TEST_REDIS_URL ?? 'redis://localhost:6379';
const redis = new Redis(redisUrl);

afterAll(async () => {
  await redis.quit();
});

beforeEach(async () => {
  await redis.flushdb();
});

describe('checkRateLimit against real Redis', () => {
  it('allows up to the limit, then rejects with a positive Retry-After', async () => {
    const key = 'test:bucket-a';
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) {
      const result = await checkRateLimit(redis, key, 3, 60, now);
      expect(result.allowed).toBe(true);
    }
    const exceeded = await checkRateLimit(redis, key, 3, 60, now);
    expect(exceeded.allowed).toBe(false);
    expect(exceeded.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('refills over time (deterministic via the injected `now`, no real sleeping)', async () => {
    const key = 'test:bucket-refill';
    const windowSeconds = 60;
    const limit = 1;
    const t0 = 1_000_000;

    const first = await checkRateLimit(redis, key, limit, windowSeconds, t0);
    expect(first.allowed).toBe(true);

    const tooSoon = await checkRateLimit(redis, key, limit, windowSeconds, t0 + 1_000);
    expect(tooSoon.allowed).toBe(false);

    // A full window later, exactly one token has regenerated.
    const afterWindow = await checkRateLimit(redis, key, limit, windowSeconds, t0 + windowSeconds * 1000);
    expect(afterWindow.allowed).toBe(true);
  });

  it('isolates buckets per key — one identity being limited never affects another', async () => {
    const now = 2_000_000;
    const a = await checkRateLimit(redis, 'test:key-a', 1, 60, now);
    const aAgain = await checkRateLimit(redis, 'test:key-a', 1, 60, now);
    const b = await checkRateLimit(redis, 'test:key-b', 1, 60, now);

    expect(a.allowed).toBe(true);
    expect(aAgain.allowed).toBe(false); // key-a exhausted
    expect(b.allowed).toBe(true); // key-b untouched by key-a's usage
  });

  it('never allows the bucket to exceed capacity even with a huge elapsed time', async () => {
    const key = 'test:bucket-cap';
    await checkRateLimit(redis, key, 5, 60, 1_000_000);
    // A day later — plenty of refill time, but capacity still caps it at 5, not unbounded.
    const result = await checkRateLimit(redis, key, 5, 60, 1_000_000 + 86_400_000);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBeLessThanOrEqual(5);
  });

  it('falls back to a strict in-process limit when Redis is unreachable (§14.1 fail-closed)', async () => {
    const brokenRedis = { defineCommand: () => {}, tokenBucket: async () => { throw new Error('ECONNREFUSED'); } };
    // limit=4 → fallback capacity = floor(4 * 0.25) = 1
    const key = `test:fallback:${Math.random()}`;
    const first = await checkRateLimit(brokenRedis as never, key, 4, 60, 3_000_000);
    expect(first.allowed).toBe(true);
    const second = await checkRateLimit(brokenRedis as never, key, 4, 60, 3_000_000);
    expect(second.allowed).toBe(false); // strict fallback exhausted after just 1, not 4
  });
});
