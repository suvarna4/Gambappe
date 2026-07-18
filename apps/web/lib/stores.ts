/**
 * Store singletons for route handlers (pg pool + ioredis + pg-boss), HMR-safe via globalThis.
 * Prod DB access goes through pooled connections (§10.2/§18); locally this is a small pool.
 */
import { Redis } from 'ioredis';
import PgBoss from 'pg-boss';
import type pg from 'pg';
import { createDb, createPool, type Db } from '@receipts/db';

interface StoreCache {
  pool?: pg.Pool;
  db?: Db;
  redis?: Redis;
  boss?: PgBoss;
  bossStarted?: Promise<PgBoss>;
}

const globalCache = globalThis as typeof globalThis & { __receiptsStores?: StoreCache };
const cache: StoreCache = (globalCache.__receiptsStores ??= {});

export function getPool(): pg.Pool {
  cache.pool ??= createPool({ max: 5 });
  return cache.pool;
}

export function getDb(): Db {
  cache.db ??= createDb(getPool());
  return cache.db;
}

export function getRedis(): Redis {
  if (!cache.redis) {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error('REDIS_URL is not set (see .env.example)');
    cache.redis = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 2_000,
      enableOfflineQueue: false,
    });
  }
  return cache.redis;
}

/**
 * `lazyConnect` + `enableOfflineQueue: false` means a command issued before the socket is
 * up throws ("Stream isn't writeable") rather than queuing — every caller must ensure the
 * connection first. Centralized here so each new Redis consumer doesn't reimplement it.
 */
export async function ensureRedisConnected(redis: Redis): Promise<Redis> {
  if (redis.status === 'wait' || redis.status === 'end') {
    await redis.connect();
  }
  return redis;
}

/**
 * Started, cached pg-boss client (§2.2: apps/web enqueues, apps/worker consumes/schedules).
 * `.start()` is idempotent (migration check) but not cheap enough to call per-request, so it's
 * memoized process-wide via the same globalThis HMR-safe pattern as the other stores above.
 */
export function getBoss(): Promise<PgBoss> {
  if (!cache.bossStarted) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is not set (see .env.example)');
    const boss = new PgBoss({ connectionString, schema: 'pgboss' });
    cache.boss = boss;
    cache.bossStarted = boss.start();
  }
  return cache.bossStarted;
}
