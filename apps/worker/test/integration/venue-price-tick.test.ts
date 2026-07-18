/**
 * WS1-T4 integration AC: a mock venue price change appears in Redis + DB within one
 * `venue:price-tick`; 3 consecutive failures set the `venue_degraded` flag, one success
 * clears it (§7.5). Requires a live Postgres + Redis (docker-compose / CI service).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Redis } from 'ioredis';
import type pg from 'pg';
import { connect, markets, questions, type Db } from '@receipts/db';
import { buildMarket, buildQuestion } from '@receipts/db/testing';
import { MockVenueAdapter } from '@receipts/venues/mock';
import { runVenuePriceTick } from '../../src/jobs/venue-price-tick.js';

const dbUrl =
  process.env.TEST_DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts_test';
const redisUrl =
  process.env.TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6379';

const NOW = new Date('2026-07-19T10:10:00Z');

let pool: pg.Pool;
let db: Db;
let redis: Redis;

async function insertOpenQuestionMarket(
  venueMarketId: string,
  venue: 'kalshi' | 'polymarket' = 'kalshi',
): Promise<{ marketId: string; questionId: string }> {
  const market = buildMarket({ venue, venueMarketId, status: 'open' });
  await db.insert(markets).values(market);
  const question = buildQuestion(market.id as string, { status: 'open' });
  await db.insert(questions).values(question);
  return { marketId: market.id as string, questionId: question.id as string };
}

beforeAll(async () => {
  ({ pool, db } = connect({ connectionString: dbUrl }));
  await db.execute(sql`DROP SCHEMA public CASCADE`);
  await db.execute(sql`CREATE SCHEMA public`);
  await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  await migrate(db, {
    migrationsFolder: join(
      dirname(fileURLToPath(import.meta.url)),
      '..', '..', '..', '..', 'packages', 'db', 'drizzle',
    ),
  });

  redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
  await redis.flushdb();
});

afterAll(async () => {
  await pool.end();
  redis.disconnect();
});

describe('venue:price-tick (§7.5)', () => {
  it('writes a fresh price to Redis (with TTL) and the DB within one tick', async () => {
    const { marketId } = await insertOpenQuestionMarket('TICK-KNOWN-1');
    const adapter = new MockVenueAdapter('kalshi');
    adapter.addMarket({ venueMarketId: 'TICK-KNOWN-1', yesPrice: 0.5 });
    adapter.setYesPrice('TICK-KNOWN-1', 0.81, NOW);

    const report = await runVenuePriceTick(db, redis, [adapter], NOW);
    expect(report.updated).toBe(1);
    expect(report.snapshotted).toBe(1); // question is 'open' — snapshot every tick

    const cached = await redis.get('price:kalshi:TICK-KNOWN-1');
    expect(cached).not.toBeNull();
    expect(JSON.parse(cached!)).toMatchObject({ yesPrice: 0.81 });
    const ttl = await redis.ttl('price:kalshi:TICK-KNOWN-1');
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(300);

    const row = await db.execute(sql`SELECT yes_price FROM markets WHERE id = ${marketId}`);
    expect(Number(row.rows[0]!['yes_price'])).toBeCloseTo(0.81, 5);

    const snapshots = await db.execute(
      sql`SELECT yes_price FROM market_price_snapshots WHERE market_id = ${marketId}`,
    );
    expect(snapshots.rows).toHaveLength(1);
    expect(Number(snapshots.rows[0]!['yes_price'])).toBeCloseTo(0.81, 5);
  });

  it('snapshots a locked-only market at most every 5 minutes', async () => {
    const market = buildMarket({ venue: 'kalshi', venueMarketId: 'TICK-LOCKED-1', status: 'open' });
    await db.insert(markets).values(market);
    const question = buildQuestion(market.id as string, { status: 'locked' });
    await db.insert(questions).values(question);

    const adapter = new MockVenueAdapter('kalshi');
    adapter.addMarket({ venueMarketId: 'TICK-LOCKED-1', yesPrice: 0.3 });

    const t0 = NOW;
    const r0 = await runVenuePriceTick(db, redis, [adapter], t0);
    expect(r0.snapshotted).toBe(1); // first tick: no prior snapshot, always snapshots

    const t1 = new Date(t0.getTime() + 60_000); // 1 min later — within the 5-min window
    const r1 = await runVenuePriceTick(db, redis, [adapter], t1);
    expect(r1.snapshotted).toBe(0);
    expect(r1.updated).toBe(1); // price/Redis still update every tick regardless of snapshot cadence

    const t2 = new Date(t0.getTime() + 6 * 60_000); // past the 5-min window
    const r2 = await runVenuePriceTick(db, redis, [adapter], t2);
    expect(r2.snapshotted).toBe(1);

    const snapshots = await db.execute(
      sql`SELECT ts FROM market_price_snapshots WHERE market_id = ${market.id} ORDER BY ts`,
    );
    expect(snapshots.rows).toHaveLength(2); // t0 and t2 only, not t1
  });

  it('sets venue_degraded after 3 consecutive failed ticks and clears it on the next success', async () => {
    // Isolated to 'polymarket' (a separate MockVenueAdapter instance + a separate Redis
    // venue_degraded key from the 'kalshi' tests above) — by this point in the file the DB
    // also has leftover 'kalshi' markets from earlier tests that are still open/locked, and
    // Postgres row order for `listMarketsForPriceTick` isn't guaranteed, so sharing 'kalshi'
    // here would make the "all attempts failed this tick" assertion order-dependent.
    await insertOpenQuestionMarket('TICK-DEGRADE-1', 'polymarket');
    const adapter = new MockVenueAdapter('polymarket');
    adapter.addMarket({ venueMarketId: 'TICK-DEGRADE-1', yesPrice: 0.6 });

    for (let i = 0; i < 3; i++) {
      adapter.failNext('getYesPrice');
      const report = await runVenuePriceTick(db, redis, [adapter], NOW);
      expect(report.failed).toBeGreaterThan(0);
    }
    expect(await redis.get('venue_degraded:polymarket')).toBe('1');

    const report = await runVenuePriceTick(db, redis, [adapter], NOW);
    expect(report.updated).toBeGreaterThan(0);
    expect(await redis.get('venue_degraded:polymarket')).toBeNull();
  });
});
