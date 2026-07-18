/**
 * WS7-T2 integration: `getTodayQuestionPublic`/`getQuestionPublicBySlug` against a real
 * Postgres — the query layer + effective-status/crowd-hiding assembly end to end, not just
 * the pure logic already covered by `test/question-view.test.ts`. Requires a live Postgres
 * (docker-compose / CI service), same pattern as `claim-flow.test.ts`.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type pg from 'pg';
import { connect, markets, questions, type Db } from '@receipts/db';
import { buildMarket, buildQuestion } from '@receipts/db/testing';
import { getQuestionPublicBySlug, getTodayQuestionPublic } from '@/lib/question-view';

const url =
  process.env.TEST_DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts_test';

let pool: pg.Pool;
let db: Db;

beforeAll(async () => {
  ({ pool, db } = connect({ connectionString: url }));
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
  await pool.end();
});

async function insertMarketAndQuestion(
  marketOverrides: Parameters<typeof buildMarket>[0] = {},
  questionOverrides: Parameters<typeof buildQuestion>[1] = {},
) {
  const market = buildMarket(marketOverrides);
  await db.insert(markets).values(market);
  const question = buildQuestion(market.id as string, questionOverrides);
  await db.insert(questions).values(question);
  return { market, question };
}

describe('getQuestionPublicBySlug (§9.2 GET /questions/:slug shape, via Postgres)', () => {
  it('returns null for an unknown slug', async () => {
    const result = await getQuestionPublicBySlug(db, 'no-such-question');
    expect(result).toBeNull();
  });

  it('never returns a draft question (not spectator-servable)', async () => {
    const { question } = await insertMarketAndQuestion({}, { status: 'draft' });
    const result = await getQuestionPublicBySlug(db, question.slug as string);
    expect(result).toBeNull();
  });

  it('renders open with live price and a hidden crowd, even with real DB rows/counters', async () => {
    const { question } = await insertMarketAndQuestion(
      { yesPrice: 0.71 },
      { status: 'open', yesCount: 10, noCount: 4 },
    );
    const result = await getQuestionPublicBySlug(db, question.slug as string, {
      nowMsValue: (question.openAt as Date).getTime() + 60_000,
    });
    expect(result).not.toBeNull();
    expect(result!.status).toBe('open');
    expect(result!.crowd).toBeNull();
    expect(result!.yes_price).toBe(0.71);
  });

  it('renders locked from the lock snapshot once lock_at has passed, even though raw status is still open', async () => {
    const { question } = await insertMarketAndQuestion(
      {},
      { status: 'open', crowdYesAtLock: 6, crowdNoAtLock: 4, yesPriceAtLock: 0.6 },
    );
    const result = await getQuestionPublicBySlug(db, question.slug as string, {
      nowMsValue: (question.lockAt as Date).getTime() + 1000,
    });
    expect(result!.status).toBe('locked');
    expect(result!.crowd).toEqual({ yes: 6, no: 4, pct_yes: 60 });
  });

  it('renders revealed with outcome + final crowd', async () => {
    const revealedAt = new Date('2026-08-01T00:00:00Z');
    const { question } = await insertMarketAndQuestion(
      {},
      {
        status: 'revealed',
        crowdYesAtLock: 3,
        crowdNoAtLock: 7,
        outcome: 'no',
        revealedAt,
      },
    );
    const result = await getQuestionPublicBySlug(db, question.slug as string, {
      nowMsValue: revealedAt.getTime() + 1000,
    });
    expect(result!.status).toBe('revealed');
    expect(result!.outcome).toBe('no');
    expect(result!.crowd).toEqual({ yes: 3, no: 7, pct_yes: 30 });
  });

  it('renders voided with the void reason and no crowd when it never locked', async () => {
    const { question } = await insertMarketAndQuestion(
      {},
      { status: 'voided', voidReason: 'venue cancelled the event' },
    );
    const result = await getQuestionPublicBySlug(db, question.slug as string);
    expect(result!.status).toBe('voided');
    expect(result!.void_reason).toBe('venue cancelled the event');
    expect(result!.crowd).toBeNull();
  });
});

describe('getTodayQuestionPublic (§9.2 GET /questions/today, via Postgres)', () => {
  it('returns null when no daily question exists for the current ET date', async () => {
    const nowMsValue = new Date('2026-09-01T13:00:00Z').getTime(); // 09:00 ET
    const result = await getTodayQuestionPublic(db, { nowMsValue });
    expect(result).toBeNull();
  });

  it('finds the daily question whose question_date matches today (ET)', async () => {
    const nowMsValue = new Date('2026-09-02T13:00:00Z').getTime(); // 09:00 ET on 2026-09-02
    const { question } = await insertMarketAndQuestion(
      {},
      {
        kind: 'daily',
        questionDate: '2026-09-02',
        status: 'open',
        openAt: new Date('2026-09-02T13:00:00Z'),
        lockAt: new Date('2026-09-02T16:00:00Z'),
      },
    );
    const result = await getTodayQuestionPublic(db, { nowMsValue });
    expect(result).not.toBeNull();
    expect(result!.slug).toBe(question.slug);
    expect(result!.status).toBe('open');
  });

  it('ignores a daily question for a different date', async () => {
    const nowMsValue = new Date('2026-09-03T13:00:00Z').getTime();
    await insertMarketAndQuestion({}, { kind: 'daily', questionDate: '2026-09-04' });
    const result = await getTodayQuestionPublic(db, { nowMsValue });
    expect(result).toBeNull();
  });
});
