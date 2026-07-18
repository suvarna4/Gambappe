/**
 * WS3-T5 integration: `getViewerPercentile` against a real Postgres + Redis. Covers the §8.6
 * bot-exclusion asymmetry — a bot-scored profile is excluded from OTHERS' denominators (never
 * appears in the cached hash) but still gets its own percentile, computed against the full
 * (unfiltered) graded set on demand.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Redis } from 'ioredis';
import { uuidv7 } from 'uuidv7';
import type pg from 'pg';
import { connect, markets, picks, profiles, questions, type Db } from '@receipts/db';
import { buildMarket, buildPick, buildProfile, buildQuestion, computeEdge } from '@receipts/db/testing';
import { getViewerPercentile } from '@/lib/percentile';

const dbUrl =
  process.env.TEST_DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts_test';
const redisUrl =
  process.env.TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6379';

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

describe('getViewerPercentile (§8.6 bot-exclusion asymmetry)', () => {
  it('excludes a bot-scored profile from other viewers\' percentiles but still returns its own, against the full set', async () => {
    const market = buildMarket();
    await db.insert(markets).values(market);
    const question = buildQuestion(market.id as string, { status: 'revealed' });
    await db.insert(questions).values(question);

    const clean1 = buildProfile({ botScore: 0 });
    const clean2 = buildProfile({ botScore: 0 });
    const bot = buildProfile({ botScore: 0.95 });
    await db.insert(profiles).values([clean1, clean2, bot]);

    // Bot has the best edge of all three — if it wrongly appeared in the shared denominator,
    // clean1/clean2's percentiles would be pulled down by it.
    await db.insert(picks).values([
      buildPick(question.id as string, clean1.id as string, {
        id: uuidv7(), side: 'yes', result: 'win', edge: computeEdge('yes', 0.5, true),
      }),
      buildPick(question.id as string, clean2.id as string, {
        id: uuidv7(), side: 'no', result: 'loss', edge: computeEdge('no', 0.5, false),
      }),
      buildPick(question.id as string, bot.id as string, {
        id: uuidv7(), side: 'yes', result: 'win', edge: computeEdge('yes', 0.01, true),
      }),
    ]);

    // clean1 is the sole (non-excluded) winner among 2 non-excluded picks -> 100th percentile.
    const clean1Pct = await getViewerPercentile(db, redis, question.id as string, clean1.id as string);
    expect(clean1Pct).toBeCloseTo(100, 5);

    // The bot never appears in clean1's/clean2's denominator (still exactly 2-participant math).
    const clean2Pct = await getViewerPercentile(db, redis, question.id as string, clean2.id as string);
    expect(clean2Pct).toBeCloseTo(0, 5);

    // The bot still gets ITS OWN percentile, against the full (unfiltered) 3-participant set —
    // not null, and not cached into the shared reveal:{questionId} hash.
    const botPct = await getViewerPercentile(db, redis, question.id as string, bot.id as string);
    expect(botPct).not.toBeNull();
    expect(botPct).toBeCloseTo(100, 5); // bot's edge (0.99) is the best of all three

    const cachedBotField = await redis.hget(`reveal:${question.id}`, bot.id as string);
    expect(cachedBotField).toBeNull(); // not polluting the shared excluded-set cache
  });

  it('returns null for a profile with no graded pick on the question at all', async () => {
    const market = buildMarket();
    await db.insert(markets).values(market);
    const question = buildQuestion(market.id as string, { status: 'revealed' });
    await db.insert(questions).values(question);
    const spectator = buildProfile();
    await db.insert(profiles).values(spectator);

    const pct = await getViewerPercentile(db, redis, question.id as string, spectator.id as string);
    expect(pct).toBeNull();
  });
});
