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
import {
  connect,
  getMarketById,
  getQuestionById,
  markets,
  picks,
  profiles,
  questions,
  streakFreezeUses,
  type Db,
} from '@receipts/db';
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
    // §10.5 share URLs point at the REAL routes (/api/og/question, /api/cards/question — the
    // WS14-T4 drill found the old /api/og/q/ path 404ing) and are content-addressed with the
    // same `?v=` hash the route guard recomputes, so they render directly instead of 302ing.
    expect(payload.share.og_url).toMatch(
      /^https:\/\/receipts\.example\/api\/og\/question\/2026-08-05-reveal-payload-test\?v=[0-9a-f]+$/,
    );
    expect(payload.share.card_urls).toHaveLength(2);
    for (const [i, format] of (['story', 'square'] as const).entries()) {
      expect(payload.share.card_urls[i]).toMatch(
        new RegExp(
          `^https://receipts\\.example/api/cards/question/2026-08-05-reveal-payload-test\\?format=${format}&v=[0-9a-f]+$`,
        ),
      );
    }
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

  it('viewer.streak.freeze_used is true when a freeze covered the gap since the last answered daily', async () => {
    const market = buildMarket({ status: 'resolved', outcome: 'yes' });
    await db.insert(markets).values(market);

    // Day1: answered. Day2: missed, freeze-covered. Day3: today's reveal, answered.
    const day1 = buildQuestion(market.id as string, {
      questionDate: '2026-08-10',
      status: 'revealed',
      outcome: 'yes',
      settledAt: new Date('2026-08-10T20:00:00Z'),
      revealedAt: new Date('2026-08-10T20:00:00Z'),
      slug: '2026-08-10-freeze-used-day1',
    });
    const day2 = buildQuestion(market.id as string, {
      questionDate: '2026-08-11',
      status: 'revealed',
      outcome: 'yes',
      settledAt: new Date('2026-08-11T20:00:00Z'),
      revealedAt: new Date('2026-08-11T20:00:00Z'),
      slug: '2026-08-11-freeze-used-day2',
    });
    const day3 = buildQuestion(market.id as string, {
      questionDate: '2026-08-12',
      status: 'revealed',
      outcome: 'yes',
      settledAt: new Date('2026-08-12T20:00:00Z'),
      revealedAt: new Date('2026-08-12T20:00:00Z'),
      slug: '2026-08-12-freeze-used-day3',
    });
    await db.insert(questions).values([day1, day2, day3]);

    // Post-reveal:fire state: Day1 counted, Day2 freeze-covered (no break), Day3 counted -> 2.
    const viewer = buildProfile({ currentStreak: 2, bestStreak: 2 });
    await db.insert(profiles).values(viewer);
    await db.insert(picks).values([
      buildPick(day1.id as string, viewer.id as string, {
        side: 'yes',
        yesPriceAtEntry: 0.6,
        result: 'win',
        edge: computeEdge('yes', 0.6, true),
        gradedAt: day1.settledAt!,
      }),
      buildPick(day3.id as string, viewer.id as string, {
        side: 'yes',
        yesPriceAtEntry: 0.6,
        result: 'win',
        edge: computeEdge('yes', 0.6, true),
        gradedAt: day3.settledAt!,
      }),
    ]);
    await db.insert(streakFreezeUses).values({
      profileId: viewer.id as string,
      coveredDate: '2026-08-11',
      usedAt: new Date('2026-08-12T03:30:00Z'),
    });

    const question = await getQuestionById(db, day3.id as string);
    const market3 = await getMarketById(db, market.id as string);

    const payload = await buildRevealPayload({
      db,
      redis,
      question: question!,
      market: market3!,
      viewerProfileId: viewer.id as string,
      appUrl: 'https://receipts.example',
      at: new Date('2026-08-12T20:05:00Z'),
    });

    expect(payload.viewer?.streak.freeze_used).toBe(true);
    expect(payload.viewer?.streak.current).toBe(2);
    expect(payload.viewer?.streak.delta).toBe(1); // before (through day2) was 1, now 2
  });

  it('a late-opened reveal reflects streak state AS OF that day, not the live profile (which may have advanced further since)', async () => {
    const market = buildMarket({ status: 'resolved', outcome: 'yes' });
    await db.insert(markets).values(market);

    // Day1 and Day2 (the reveal under test) both answered; Day3 (already revealed/counted by
    // the time this viewer opens Day2's reveal) is a THIRD day the live profile has moved past.
    const day1 = buildQuestion(market.id as string, {
      questionDate: '2026-09-01',
      status: 'revealed',
      outcome: 'yes',
      settledAt: new Date('2026-09-01T20:00:00Z'),
      revealedAt: new Date('2026-09-01T20:00:00Z'),
      slug: '2026-09-01-late-reveal-day1',
    });
    const day2 = buildQuestion(market.id as string, {
      questionDate: '2026-09-02',
      status: 'revealed',
      outcome: 'yes',
      settledAt: new Date('2026-09-02T20:00:00Z'),
      revealedAt: new Date('2026-09-02T20:00:00Z'),
      slug: '2026-09-02-late-reveal-day2',
    });
    const day3 = buildQuestion(market.id as string, {
      questionDate: '2026-09-03',
      status: 'revealed',
      outcome: 'yes',
      settledAt: new Date('2026-09-03T20:00:00Z'),
      revealedAt: new Date('2026-09-03T20:00:00Z'),
      slug: '2026-09-03-late-reveal-day3',
    });
    await db.insert(questions).values([day1, day2, day3]);

    // Live profile state reflects Day3 already having counted (currentStreak=3) — a viewer
    // opening Day2's reveal AFTER Day3 has fired should still see Day2's own state (2), not 3.
    const viewer = buildProfile({ currentStreak: 3, bestStreak: 3 });
    await db.insert(profiles).values(viewer);
    await db.insert(picks).values([
      buildPick(day1.id as string, viewer.id as string, {
        side: 'yes',
        yesPriceAtEntry: 0.6,
        result: 'win',
        edge: computeEdge('yes', 0.6, true),
        gradedAt: day1.settledAt!,
      }),
      buildPick(day2.id as string, viewer.id as string, {
        side: 'yes',
        yesPriceAtEntry: 0.6,
        result: 'win',
        edge: computeEdge('yes', 0.6, true),
        gradedAt: day2.settledAt!,
      }),
      buildPick(day3.id as string, viewer.id as string, {
        side: 'yes',
        yesPriceAtEntry: 0.6,
        result: 'win',
        edge: computeEdge('yes', 0.6, true),
        gradedAt: day3.settledAt!,
      }),
    ]);

    const question = await getQuestionById(db, day2.id as string);
    const market2 = await getMarketById(db, market.id as string);

    // "Late" relative to day2's reveal — well after day3 has already fired too.
    const payload = await buildRevealPayload({
      db,
      redis,
      question: question!,
      market: market2!,
      viewerProfileId: viewer.id as string,
      appUrl: 'https://receipts.example',
      at: new Date('2026-09-04T12:00:00Z'),
    });

    expect(payload.viewer?.streak.current).toBe(2); // as of day2, not the live 3
    expect(payload.viewer?.streak.best).toBe(2);
    expect(payload.viewer?.streak.delta).toBe(1); // before (through day1) was 1, now 2
  });
});
