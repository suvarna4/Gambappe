/**
 * Store singletons for route handlers (pg pool + ioredis), HMR-safe via globalThis.
 * Prod DB access goes through pooled connections (§10.2/§18); locally this is a small pool.
 */
import { Redis } from 'ioredis';
import type pg from 'pg';
import { createDb, createPool, type Db } from '@receipts/db';

interface StoreCache {
  pool?: pg.Pool;
  db?: Db;
  redis?: Redis;
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
