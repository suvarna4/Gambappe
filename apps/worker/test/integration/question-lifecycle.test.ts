/**
 * WS3-T1 integration: `question:open`/`question:lock` (§5.3, §5.7, §6.2 lock job) against a
 * real Postgres + Redis. Covers idempotent double-fire and the lock snapshot (bot-excluded
 * crowd counts, price from the cache/DB ladder — no sync-fetch rung for the lock job).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Redis } from 'ioredis';
import { uuidv7 } from 'uuidv7';
import type pg from 'pg';
import { connect, insertPriceSnapshot, markets, picks, profiles, questions, type Db } from '@receipts/db';
import { buildMarket, buildPick, buildProfile, buildQuestion } from '@receipts/db/testing';
import { runQuestionOpen } from '../../src/jobs/question-open.js';
import { runQuestionLock } from '../../src/jobs/question-lock.js';

const dbUrl =
  process.env.TEST_DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts_test';
const redisUrl =
  process.env.TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6379';

const NOW = new Date('2026-07-19T16:00:00Z');

let pool: pg.Pool;
let db: Db;
let redis: Redis;

beforeAll(async () => {
  ({ pool, db } = connect({ connectionString: dbUrl }));
  await db.execute(sql`DROP SCHEMA public CASCADE`);
  await db.execute(sql`CREATE SCHEMA public`);
  await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  await migrate(db, {
    migrationsFolder: join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'packages', 'db', 'drizzle'),
  });

  redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
  await redis.flushdb();
});

afterAll(async () => {
  await pool.end();
  redis.disconnect();
});

describe('question:open (§5.7)', () => {
  it('transitions scheduled → open, and a duplicate fire is a no-op', async () => {
    const market = buildMarket();
    await db.insert(markets).values(market);
    const question = buildQuestion(market.id as string, { status: 'scheduled' });
    await db.insert(questions).values(question);

    const first = await runQuestionOpen(pool, question.id as string, NOW);
    expect(first.opened).toBe(true);
    const [row1] = await db.select().from(questions).where(sql`id = ${question.id}`);
    expect(row1!.status).toBe('open');

    const second = await runQuestionOpen(pool, question.id as string, NOW);
    expect(second.opened).toBe(false);
    const [row2] = await db.select().from(questions).where(sql`id = ${question.id}`);
    expect(row2!.status).toBe('open'); // unchanged
  });
});

describe('question:lock (§6.2 lock job)', () => {
  it('transitions open → locked, snapshots bot-excluded crowd counts and price, and a duplicate fire is a no-op', async () => {
    const market = buildMarket({ venue: 'kalshi', venueMarketId: 'LOCK-TEST-1', yesPrice: 0.5, yesPriceUpdatedAt: NOW });
    await db.insert(markets).values(market);
    const question = buildQuestion(market.id as string, { status: 'open' });
    await db.insert(questions).values(question);

    const [cleanA, cleanB, bot] = [
      buildProfile(),
      buildProfile(),
      buildProfile({ botScore: 0.95 }),
    ];
    await db.insert(profiles).values([cleanA, cleanB, bot]);
    await db.insert(picks).values([
      buildPick(question.id as string, cleanA.id as string, { id: uuidv7(), side: 'yes' }),
      buildPick(question.id as string, cleanB.id as string, { id: uuidv7(), side: 'no' }),
      buildPick(question.id as string, bot.id as string, { id: uuidv7(), side: 'yes' }), // excluded
    ]);

    // Fresh Redis cache — the lock job should prefer this over the (also-fresh) DB fallback.
    await redis.set(
      `price:${market.venue}:${market.venueMarketId}`,
      JSON.stringify({ yesPrice: 0.73, ts: NOW.toISOString() }),
      'EX',
      300,
    );

    const first = await runQuestionLock(db, pool, redis, question.id as string, NOW);
    expect(first.locked).toBe(true);
    expect(first.crowdYesAtLock).toBe(1); // bot's yes pick excluded
    expect(first.crowdNoAtLock).toBe(1);

    const [row1] = await db.select().from(questions).where(sql`id = ${question.id}`);
    expect(row1!.status).toBe('locked');
    expect(row1!.crowdYesAtLock).toBe(1);
    expect(row1!.crowdNoAtLock).toBe(1);
    expect(Number(row1!.yesPriceAtLock)).toBeCloseTo(0.73, 5); // from cache, not the DB's 0.5

    const second = await runQuestionLock(db, pool, redis, question.id as string, NOW);
    expect(second.locked).toBe(false); // idempotent — already locked
  });

  it('falls back to the DB price when the cache is empty, and to null when both are stale (no sync-fetch rung)', async () => {
    const marketFallback = buildMarket({
      venue: 'kalshi',
      venueMarketId: 'LOCK-TEST-2',
      yesPrice: 0.41,
      yesPriceUpdatedAt: NOW,
    });
    await db.insert(markets).values(marketFallback);
    const questionFallback = buildQuestion(marketFallback.id as string, { status: 'open' });
    await db.insert(questions).values(questionFallback);

    const result = await runQuestionLock(db, pool, redis, questionFallback.id as string, NOW);
    expect(result.locked).toBe(true);
    const [row] = await db.select().from(questions).where(sql`id = ${questionFallback.id}`);
    expect(Number(row!.yesPriceAtLock)).toBeCloseTo(0.41, 5);

    // A second question whose market price is stale beyond PRICE_FALLBACK_STALENESS_S, no cache.
    const staleAt = new Date(NOW.getTime() - 10 * 60_000);
    const marketStale = buildMarket({
      venue: 'kalshi',
      venueMarketId: 'LOCK-TEST-3',
      yesPrice: 0.2,
      yesPriceUpdatedAt: staleAt,
    });
    await db.insert(markets).values(marketStale);
    const questionStale = buildQuestion(marketStale.id as string, { status: 'open' });
    await db.insert(questions).values(questionStale);

    const staleResult = await runQuestionLock(db, pool, redis, questionStale.id as string, NOW);
    expect(staleResult.locked).toBe(true);
    const [staleRow] = await db.select().from(questions).where(sql`id = ${questionStale.id}`);
    expect(staleRow!.yesPriceAtLock).toBeNull(); // all rungs exhausted — locking still proceeds
  });

  it('late fire (worker outage): backfills from the price snapshot nearest lock_at, not the current price (§5.7)', async () => {
    const lockAt = NOW;
    const lateFireAt = new Date(NOW.getTime() + 20 * 60_000); // 20 min late — well past PRICE_MAX_STALENESS_S

    // Market's current price has since moved on and was updated recently relative to the late
    // fire — the old, buggy ladder would treat this as "fresh" and wrongly stamp it.
    const market = buildMarket({
      venue: 'kalshi',
      venueMarketId: 'LOCK-LATE-1',
      yesPrice: 0.9,
      yesPriceUpdatedAt: lateFireAt,
    });
    await db.insert(markets).values(market);
    const question = buildQuestion(market.id as string, { status: 'open', lockAt });
    await db.insert(questions).values(question);

    // The actual price snapshot nearest lock_at — this is what should win.
    await insertPriceSnapshot(db, market.id as string, lockAt, 0.65);
    // A farther-away snapshot near the late fire time, to prove "nearest" really means nearest.
    await insertPriceSnapshot(db, market.id as string, lateFireAt, 0.9);

    const result = await runQuestionLock(db, pool, redis, question.id as string, lateFireAt);
    expect(result.locked).toBe(true);
    const [row] = await db.select().from(questions).where(sql`id = ${question.id}`);
    expect(Number(row!.yesPriceAtLock)).toBeCloseTo(0.65, 5);
  });
});
