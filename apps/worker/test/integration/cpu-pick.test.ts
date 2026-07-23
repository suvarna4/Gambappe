/**
 * WS26-T5 integration (docs/plans/cpu-nemesis-wbs.md): the cpu:pick sweep against real
 * Postgres + Redis. ACs: covers BOTH the pairing's bonus question AND the week's derived
 * daily (the exact gap the event-triggered design had — review correction 1); stamps the
 * real ladder price with source='cpu'; Clock waits outside its window; a second sweep is a
 * no-op (worklist excludes already-picked questions); dead-even markets skip.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { uuidv7 } from 'uuidv7';
import { Redis } from 'ioredis';
import type pg from 'pg';
import {
  connect,
  markets,
  nemesisPairings,
  pairingQuestions,
  picks,
  profiles,
  questions,
  seasons,
  seedCpuRoster,
  type Db,
} from '@receipts/db';
import { CPU_CLOCK_PICK_WINDOW_MS } from '@receipts/engine';
import { buildMarket, buildProfile, buildQuestion, buildSeason } from '@receipts/db/testing';
import { runCpuPickSweep } from '../../src/jobs/cpu-pick.js';

const dbUrl =
  process.env.TEST_DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts_test';
const redisUrl = process.env.TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6379';

let pool: pg.Pool;
let db: Db;
let redis: Redis;

const NOW = new Date();
const isoDate = (d: Date): string => d.toISOString().slice(0, 10);
const WEEK_START = isoDate(new Date(NOW.getTime() - 24 * 3600_000));

beforeAll(async () => {
  ({ pool, db } = connect({ connectionString: dbUrl }));
  redis = new Redis(redisUrl);
  await db.execute(sql`DROP SCHEMA public CASCADE`);
  await db.execute(sql`CREATE SCHEMA public`);
  await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  await migrate(db, {
    migrationsFolder: join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      '..',
      '..',
      'packages',
      'db',
      'drizzle',
    ),
  });
});

afterAll(async () => {
  redis.disconnect();
  await pool.end();
});

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE TABLE nemesis_pairings, pairing_questions, seasons, picks, questions, markets, profiles CASCADE`,
  );
  await redis.flushdb();
});

/** One active CPU pairing (human vs the given persona's roster CPU) + a season. */
async function makeCpuPairing(persona: 'chalk' | 'fade' | 'longshot' | 'clock') {
  const roster = await seedCpuRoster(db, NOW);
  const human = buildProfile();
  await db.insert(profiles).values(human);
  const season = buildSeason();
  await db.insert(seasons).values(season);
  const pairingId = uuidv7();
  const cpuId = roster[persona];
  const [a, b] = human.id < cpuId ? [human.id, cpuId] : [cpuId, human.id];
  await db.insert(nemesisPairings).values({
    id: pairingId,
    seasonId: season.id,
    weekStart: WEEK_START,
    profileAId: a,
    profileBId: b,
    status: 'active',
  });
  return { pairingId, cpuId, humanId: human.id };
}

/** An open question on a fresh market with a DB-fallback price (no cache entry). */
async function makeOpenQuestion(opts: {
  kind: 'daily' | 'nemesis_bonus';
  yesPrice: number;
  lockInMs: number;
  pairingId?: string;
}) {
  const market = buildMarket({ yesPrice: opts.yesPrice, yesPriceUpdatedAt: NOW });
  await db.insert(markets).values(market);
  const question = buildQuestion(market.id, {
    kind: opts.kind,
    status: 'open',
    questionDate: opts.kind === 'daily' ? isoDate(NOW) : null,
    lockAt: new Date(NOW.getTime() + opts.lockInMs),
  });
  await db.insert(questions).values(question);
  if (opts.pairingId) {
    await db
      .insert(pairingQuestions)
      .values({ pairingId: opts.pairingId, questionId: question.id });
  }
  return { question, market };
}

describe('cpu:pick sweep (WS26-T5)', () => {
  it('picks BOTH the bonus question and the week daily, at the stamped price, source=cpu', async () => {
    const { pairingId, cpuId } = await makeCpuPairing('chalk');
    const { question: daily } = await makeOpenQuestion({
      kind: 'daily',
      yesPrice: 0.62,
      lockInMs: 3600_000,
    });
    const { question: bonus } = await makeOpenQuestion({
      kind: 'nemesis_bonus',
      yesPrice: 0.31,
      lockInMs: 3600_000,
      pairingId,
    });

    const report = await runCpuPickSweep(db, redis, NOW);
    expect(report.targets).toBe(2);
    expect(report.picked).toBe(2);

    const cpuPicks = await db
      .select()
      .from(picks)
      .where(sql`profile_id = ${cpuId}`);
    expect(cpuPicks).toHaveLength(2);
    const bySide = new Map(cpuPicks.map((p) => [p.questionId, p]));
    expect(bySide.get(daily.id)!.side).toBe('yes'); // chalk takes the 0.62 favorite
    expect(bySide.get(bonus.id)!.side).toBe('no'); // favorite of a 0.31 market is NO
    for (const p of cpuPicks) {
      expect(p.source).toBe('cpu');
      expect(Number(p.yesPriceAtEntry)).toBeGreaterThan(0);
      expect(p.priceStampedAt).not.toBeNull();
    }

    // Idempotency: the next sweep's worklist no longer contains these questions.
    const second = await runCpuPickSweep(db, redis, NOW);
    expect(second.targets).toBe(0);
    expect(
      await db
        .select()
        .from(picks)
        .where(sql`profile_id = ${cpuId}`),
    ).toHaveLength(2);
  });

  it('Clock waits outside its window and picks inside it', async () => {
    const { cpuId } = await makeCpuPairing('clock');
    const { market } = await makeOpenQuestion({
      kind: 'daily',
      yesPrice: 0.7,
      lockInMs: CPU_CLOCK_PICK_WINDOW_MS + 60 * 60_000,
    });

    const early = await runCpuPickSweep(db, redis, NOW);
    expect(early.waited).toBe(1);
    expect(early.picked).toBe(0);

    // A later tick, now inside the window (only `at` advances). The hour-old DB price is
    // past PRICE_FALLBACK_STALENESS_S by then, so the tick reads a fresh CACHE entry — which
    // also exercises the ladder's cache rung.
    const lateAt = new Date(NOW.getTime() + 60 * 60_000 + 60_000);
    await redis.set(
      `price:${market.venue}:${market.venueMarketId}`,
      JSON.stringify({ yesPrice: 0.7, ts: lateAt.toISOString() }),
    );
    const late = await runCpuPickSweep(db, redis, lateAt);
    expect(late.picked).toBe(1);
    const cpuPicks = await db
      .select()
      .from(picks)
      .where(sql`profile_id = ${cpuId}`);
    expect(cpuPicks).toHaveLength(1);
    expect(cpuPicks[0]!.side).toBe('yes');
  });

  it('skips a dead-even market and reports price-unavailable instead of guessing', async () => {
    const { pairingId } = await makeCpuPairing('fade');
    await makeOpenQuestion({ kind: 'nemesis_bonus', yesPrice: 0.5, lockInMs: 3600_000, pairingId });
    // A second bonus with NO price anywhere (no cache, null market price).
    const market = buildMarket({ yesPrice: null, yesPriceUpdatedAt: null });
    await db.insert(markets).values(market);
    const unpriced = buildQuestion(market.id, {
      kind: 'nemesis_bonus',
      status: 'open',
      questionDate: null,
      lockAt: new Date(NOW.getTime() + 3600_000),
    });
    await db.insert(questions).values(unpriced);
    await db.insert(pairingQuestions).values({ pairingId, questionId: unpriced.id });

    const report = await runCpuPickSweep(db, redis, NOW);
    expect(report.skipped).toBe(1); // dead-even: nothing to fade
    expect(report.priceUnavailable).toBe(1); // never guess
    expect(report.picked).toBe(0);
  });
});
