/**
 * WS3-T4/T5/T6 integration: `buildRevealPayload` against a real Postgres + Redis.
 *
 *  - Refuses to assemble a payload for a non-revealed question (defense in depth behind the
 *    route's own `REVEAL_NOT_READY` gate — §6.5/§6.7 publication rule).
 *  - Full payload snapshot: crowd, outcome, viewer block (pick/result/edge/percentile/streak),
 *    "called it" badge, share URLs. Percentile is a real number here (WS3-T5 IS wired in this
 *    branch) — the contract itself still allows `null` (schema `.nullable()`), which is the
 *    actual WS3-T4 AC ("percentile: null accepted").
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Redis } from 'ioredis';
import type pg from 'pg';
import { connect, getMarketById, getQuestionById, markets, picks, profiles, questions, type Db } from '@receipts/db';
import { buildMarket, buildPick, buildProfile, buildQuestion, computeEdge } from '@receipts/db/testing';
import { buildRevealPayload } from '@/lib/reveal-payload';

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

describe('buildRevealPayload (§6.7)', () => {
  it('throws for a question that is not actually revealed (publication rule)', async () => {
    const marketRow = buildMarket();
    await db.insert(markets).values(marketRow);
    const questionRow = buildQuestion(marketRow.id as string, { status: 'locked', settledAt: new Date() });
    await db.insert(questions).values(questionRow);

    const question = await getQuestionById(db, questionRow.id as string);
    const market = await getMarketById(db, marketRow.id as string);

    await expect(
      buildRevealPayload({
        db,
        redis,
        question: question!,
        market: market!,
        viewerProfileId: null,
        appUrl: 'https://receipts.example',
        at: new Date(),
      }),
    ).rejects.toThrow();
  });

  it('assembles the full payload: crowd, outcome, viewer block, called_it badge, share URLs', async () => {
    const marketRow = buildMarket({ status: 'resolved', outcome: 'yes' });
    await db.insert(markets).values(marketRow);
    const settledAt = new Date('2026-08-05T17:00:00Z');
    const questionRow = buildQuestion(marketRow.id as string, {
      questionDate: '2026-08-05',
      status: 'revealed',
      outcome: 'yes',
      settledAt,
      revealedAt: new Date('2026-08-05T20:00:00Z'),
      crowdYesAtLock: 3,
      crowdNoAtLock: 1,
      slug: '2026-08-05-reveal-payload-test',
    });
    await db.insert(questions).values(questionRow);

    const viewer = buildProfile({ currentStreak: 1, bestStreak: 1 });
    const other = buildProfile();
    await db.insert(profiles).values([viewer, other]);
    await db.insert(picks).values([
      buildPick(questionRow.id as string, viewer.id as string, {
        side: 'yes',
        yesPriceAtEntry: 0.15, // longshot win → called_it
        result: 'win',
        edge: computeEdge('yes', 0.15, true),
        gradedAt: settledAt,
      }),
      buildPick(questionRow.id as string, other.id as string, {
        side: 'no',
        yesPriceAtEntry: 0.85,
        result: 'loss',
        edge: computeEdge('no', 0.85, false),
        gradedAt: settledAt,
      }),
    ]);

    const question = await getQuestionById(db, questionRow.id as string);
    const market = await getMarketById(db, marketRow.id as string);

    const payload = await buildRevealPayload({
      db,
      redis,
      question: question!,
      market: market!,
      viewerProfileId: viewer.id as string,
      appUrl: 'https://receipts.example',
      at: new Date('2026-08-05T20:05:00Z'),
    });

    expect(payload.outcome).toBe('yes');
    expect(payload.crowd).toEqual({ yes: 3, no: 1, pct_yes: 75 });
    expect(payload.viewer?.result).toBe('win');
    expect(payload.viewer?.badges).toEqual(['called_it']);
    expect(payload.viewer?.percentile).toBeCloseTo(100, 5); // sole winner among 2 graded picks
    expect(payload.share.page_url).toBe('https://receipts.example/q/2026-08-05-reveal-payload-test');
    expect(payload.question.slug).toBe('2026-08-05-reveal-payload-test');
  });

  it('omits the viewer block for a spectator with no pick on the question', async () => {
    const marketRow = buildMarket({ status: 'resolved', outcome: 'no' });
    await db.insert(markets).values(marketRow);
    const questionRow = buildQuestion(marketRow.id as string, {
      questionDate: '2026-08-06',
      status: 'revealed',
      outcome: 'no',
      settledAt: new Date(),
      revealedAt: new Date(),
      crowdYesAtLock: 0,
      crowdNoAtLock: 0,
      slug: '2026-08-06-no-viewer-pick',
    });
    await db.insert(questions).values(questionRow);
    const spectator = buildProfile();
    await db.insert(profiles).values(spectator);

    const question = await getQuestionById(db, questionRow.id as string);
    const market = await getMarketById(db, marketRow.id as string);

    const payload = await buildRevealPayload({
      db,
      redis,
      question: question!,
      market: market!,
      viewerProfileId: spectator.id as string,
      appUrl: 'https://receipts.example',
      at: new Date(),
    });
    expect(payload.viewer).toBeUndefined();
  });
});
