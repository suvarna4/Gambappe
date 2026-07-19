/**
 * Audit-fix regression: `ensureRedisConnected` under a concurrent cold-start burst.
 *
 * The client is built with `lazyConnect: true, enableOfflineQueue: false` (mirroring
 * `getRedis()`), so a command issued before 'ready' throws instead of queuing. ioredis flips
 * status to 'connecting' synchronously inside connect() and rejects a second connect() — the
 * old guard (only awaiting when status was 'wait'/'end') let every caller after the first
 * fall straight through during the connect window and die on its first command. All callers
 * must instead block until 'ready'.
 */
import { Redis } from 'ioredis';
import { afterAll, describe, expect, it } from 'vitest';
import { ensureRedisConnected } from '../../lib/stores';

const redisUrl = process.env.TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6379';

const clients: Redis[] = [];

function coldClient(): Redis {
  const redis = new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 2_000,
    enableOfflineQueue: false,
  });
  clients.push(redis);
  return redis;
}

afterAll(async () => {
  await Promise.all(clients.map((c) => c.quit().catch(() => c.disconnect())));
});

describe('ensureRedisConnected (cold-start burst)', () => {
  it('20 concurrent callers on one cold client all complete their first command', async () => {
    const redis = coldClient();
    const results = await Promise.all(
      Array.from({ length: 20 }, async (_, i) => {
        await ensureRedisConnected(redis);
        return redis.set(`audit:connect-burst:${i}`, '1', 'EX', 10);
      }),
    );
    expect(results).toEqual(Array.from({ length: 20 }, () => 'OK'));
  });

  it('is idempotent on an already-ready client', async () => {
    const redis = coldClient();
    await ensureRedisConnected(redis);
    await ensureRedisConnected(redis);
    expect(redis.status).toBe('ready');
    expect(await redis.ping()).toBe('PONG');
  });
});
