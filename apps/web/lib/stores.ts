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
 *
 * Handles ALL pre-ready statuses, not just 'wait'/'end': ioredis flips status to 'connecting'
 * synchronously inside connect() and rejects a second connect() call, so under a concurrent
 * cold-start burst only the first caller may connect() — every other caller must WAIT for
 * 'ready' rather than fall through and have its first command throw. (This was the residual
 * cold-start 5xx source after the original lazy-connect fix: requests arriving during the
 * connect window skipped the await entirely.)
 */
const pendingReady = new WeakMap<Redis, Promise<void>>();

export async function ensureRedisConnected(redis: Redis): Promise<Redis> {
  if (redis.status === 'ready') return redis;

  // Single shared waiter per client: the first caller initiates (or observes) the connection
  // and every concurrent caller awaits the same promise — one connect(), one listener set,
  // no per-caller listener pileup under a burst. Cleared on settle so a FAILED connect is
  // retried fresh by the next caller instead of being memoized forever.
  let pending = pendingReady.get(redis);
  if (!pending) {
    pending = (async () => {
      if (redis.status === 'wait' || redis.status === 'end') {
        await redis.connect(); // resolves at 'ready'
        return;
      }
      // 'connecting'/'connect'/'close'/'reconnecting': a connection attempt someone else
      // started (another caller's connect(), or ioredis's own retry loop) is in flight —
      // wait for its outcome. 'error' is treated as fatal-for-this-call: callers need a
      // bounded answer, and with maxRetriesPerRequest: 1 the client isn't configured for
      // long recovery loops anyway.
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          redis.off('ready', onReady);
          redis.off('end', onEnd);
          redis.off('error', onError);
        };
        const onReady = () => {
          cleanup();
          resolve();
        };
        const onEnd = () => {
          cleanup();
          reject(new Error('ensureRedisConnected: connection ended before becoming ready'));
        };
        const onError = (err: Error) => {
          cleanup();
          reject(err);
        };
        redis.once('ready', onReady);
        redis.once('end', onEnd);
        redis.once('error', onError);
      });
    })().finally(() => {
      pendingReady.delete(redis);
    });
    pendingReady.set(redis, pending);
  }

  await pending;
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
    // On a failed start (transient DB blip on the very first enqueue), clear the memo so the
    // NEXT call retries — otherwise the rejected promise is cached forever and every later
    // settlement/curation/wallet enqueue fails until the process restarts.
    cache.bossStarted = boss.start().catch((err: unknown) => {
      if (cache.boss === boss) {
        cache.boss = undefined;
        cache.bossStarted = undefined;
      }
      // Best-effort teardown of the failed instance's internal pool — without it, every failed
      // start during a long DB outage would leak whatever connections it managed to open.
      void boss.stop().catch(() => {});
      throw err;
    });
  }
  return cache.bossStarted;
}
