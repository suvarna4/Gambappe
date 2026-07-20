/**
 * Design-diff audit integration test: `getNextDailyQuestion` (the peeking next-day card,
 * `docs/swipe-ux-plan.md` §2.5's under-card AC, §9.2 `GET /questions/tomorrow`). Mirrors
 * `daily-void-slot.test.ts`'s setup exactly (own migrated schema, `beforeEach` truncate) — a
 * sibling concern (daily-slot lookups) but kept in its own file rather than added to that one,
 * per that file's own scoping precedent of one concern per integration file.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type pg from 'pg';
import { connect, type Db } from '../../src/client.js';
import { getNextDailyQuestion, insertMarket, insertQuestion } from '../../src/repositories/questions.js';
import { buildMarket, buildQuestion } from '../../src/testing/factories.js';

const url =
  process.env.TEST_DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts_test';

let pool: pg.Pool;
let db: Db;
let marketId: string;

beforeAll(async () => {
  ({ pool, db } = connect({ connectionString: url }));
  await db.execute(sql`DROP SCHEMA public CASCADE`);
  await db.execute(sql`CREATE SCHEMA public`);
  await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  await migrate(db, {
    migrationsFolder: join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'drizzle'),
  });
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await db.execute(sql`TRUNCATE questions, markets RESTART IDENTITY CASCADE`);
  const market = buildMarket();
  await insertMarket(db, market);
  marketId = market.id;
});

const TODAY = '2026-07-20';
const TOMORROW = '2026-07-21';
const DAY_AFTER = '2026-07-22';

async function insertDaily(questionDate: string, status: string): Promise<string> {
  const q = buildQuestion(marketId, { questionDate, status: status as never });
  await insertQuestion(db, q);
  return q.id;
}

describe('getNextDailyQuestion (design-diff audit, §9.2 GET /questions/tomorrow)', () => {
  it('finds the daily question dated exactly one ET day after the given date', async () => {
    const tomorrow = await insertDaily(TOMORROW, 'scheduled');
    const row = await getNextDailyQuestion(db, TODAY);
    expect(row?.id).toBe(tomorrow);
  });

  it('returns null when curation has not reached tomorrow yet — the common case, not an error', async () => {
    expect(await getNextDailyQuestion(db, TODAY)).toBeNull();
  });

  it('ignores a daily question two days out — "tomorrow" is exact, never a fuzzy "next available" search', async () => {
    await insertDaily(DAY_AFTER, 'scheduled');
    expect(await getNextDailyQuestion(db, TODAY)).toBeNull();
  });

  it('excludes a voided tomorrow (mirrors getDailyQuestion — a voided slot reads as free)', async () => {
    await insertDaily(TOMORROW, 'voided');
    expect(await getNextDailyQuestion(db, TODAY)).toBeNull();
  });

  it('still returns a draft tomorrow row — draft-rejection is the caller\'s job (serializeQuestionPeek), same split as getDailyQuestion/assertQuestionPubliclyVisible', async () => {
    const draft = await insertDaily(TOMORROW, 'draft');
    const row = await getNextDailyQuestion(db, TODAY);
    expect(row?.id).toBe(draft);
    expect(row?.status).toBe('draft');
  });

  it('still finds the active row when a voided sibling also exists on the same tomorrow date', async () => {
    await insertDaily(TOMORROW, 'voided');
    const active = await insertDaily(TOMORROW, 'scheduled');
    const row = await getNextDailyQuestion(db, TODAY);
    expect(row?.id).toBe(active);
  });
});
