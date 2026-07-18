/**
 * Worker-side Redis singleton (§7.5 price cache + `venue_degraded` flag). Mirrors
 * `apps/web/lib/stores.ts`'s lazy-connect pattern; the worker is a single long-lived
 * process (§2.2) so a plain module-level singleton (no HMR globalThis dance needed) suffices.
 */
import { Redis } from 'ioredis';

let client: Redis | undefined;

export function getRedis(): Redis {
  if (!client) {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error('REDIS_URL is not set (see .env.example)');
    client = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 2_000,
      enableOfflineQueue: false,
    });
  }
  return client;
}

/** Test-only escape hatch: swap in a fresh (e.g. mock) client between test cases. */
export function setRedisForTesting(redis: Redis | undefined): void {
  client = redis;
}
