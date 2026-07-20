/**
 * WS15-T2 integration: voiding a daily frees its date slot for a replacement.
 * - `questions_daily_date_uq` excludes voided rows: ≤1 ACTIVE daily per date, any number of
 *   voided ones.
 * - `getDailyQuestion` returns the active row (voided-only date → null).
 * - `getPriorDayDailyQuestion` prefers the active row over a voided sibling, so the §6.6
 *   reveal-ordering guard waits on the replacement, not the cancelled predecessor.
 * - `listRevealedOrVoidedDailyThrough` collapses a voided + revealed same-date pair to the
 *   revealed row (that date's real history for streak replay), while a voided-only date
 *   still yields its voided row.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type pg from 'pg';
import { connect, type Db } from '../../src/client.js';
import {
  getDailyQuestion,
  getDailyQuestionAnyStatus,
  getPriorDayDailyQuestion,
  insertMarket,
  insertQuestion,
  listRevealedOrVoidedDailyThrough,
} from '../../src/repositories/questions.js';
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

const DATE = '2026-07-20';
const PRIOR = '2026-07-19';

async function insertDaily(status: string, questionDate = DATE): Promise<string> {
  const q = buildQuestion(marketId, { questionDate, status: status as never });
  await insertQuestion(db, q);
  return q.id;
}

describe('questions_daily_date_uq (WS15-T2)', () => {
  it('rejects a second ACTIVE daily for the same date', async () => {
    await insertDaily('scheduled');
    // Drizzle wraps the PG error; assert on the underlying SQLSTATE (23505 unique_violation).
    let caught: unknown;
    await insertDaily('scheduled').catch((err: unknown) => {
      caught = err;
    });
    expect(caught, 'second active daily must violate questions_daily_date_uq').toBeDefined();
    expect((caught as { cause?: { code?: string } }).cause?.code).toBe('23505');
  });

  it('allows a replacement once the incumbent is voided — repeatedly', async () => {
    const first = await insertDaily('scheduled');
    await db.execute(sql`UPDATE questions SET status = 'voided' WHERE id = ${first}`);
    const second = await insertDaily('scheduled'); // slot freed by the void

    await db.execute(sql`UPDATE questions SET status = 'voided' WHERE id = ${second}`);
    await insertDaily('scheduled'); // two voided rows + one active on one date is legal

    const rows = await db.execute(sql`
      SELECT count(*)::int AS n FROM questions WHERE kind = 'daily' AND question_date = ${DATE}
    `);
    expect(rows.rows[0]?.['n']).toBe(3);
  });
});

describe('getDailyQuestion (WS15-T2)', () => {
  it('returns the active replacement, never the voided predecessor', async () => {
    const voided = await insertDaily('voided');
    const active = await insertDaily('scheduled');
    const row = await getDailyQuestion(db, DATE);
    expect(row?.id).toBe(active);
    expect(row?.id).not.toBe(voided);
  });

  it('returns null for a voided-only date (the slot reads as free)', async () => {
    await insertDaily('voided');
    expect(await getDailyQuestion(db, DATE)).toBeNull();
  });
});

describe('getDailyQuestionAnyStatus (WS15-T2 — streak:sweep needs voided days as history)', () => {
  it('returns the voided row for a voided-only date', async () => {
    const voided = await insertDaily('voided');
    expect((await getDailyQuestionAnyStatus(db, DATE))?.id).toBe(voided);
  });

  it('prefers the active replacement when both exist', async () => {
    await insertDaily('voided');
    const active = await insertDaily('revealed');
    expect((await getDailyQuestionAnyStatus(db, DATE))?.id).toBe(active);
  });
});

describe('getPriorDayDailyQuestion (WS15-T2)', () => {
  it('prefers the active sibling — a locked replacement must gate the next reveal', async () => {
    await insertDaily('voided', PRIOR);
    await insertDaily('locked', PRIOR);
    expect((await getPriorDayDailyQuestion(db, DATE))?.status).toBe('locked');
  });

  it('still reports voided for a voided-only prior day (settled — reveal may proceed)', async () => {
    await insertDaily('voided', PRIOR);
    expect((await getPriorDayDailyQuestion(db, DATE))?.status).toBe('voided');
  });
});

describe('listRevealedOrVoidedDailyThrough (WS15-T2)', () => {
  it('collapses a voided + revealed same-date pair to the revealed row', async () => {
    await insertDaily('voided');
    const revealed = await insertDaily('revealed');
    await insertDaily('voided', PRIOR); // voided-only date still surfaces its voided row

    const history = await listRevealedOrVoidedDailyThrough(db, DATE);
    expect(history).toEqual([
      expect.objectContaining({ questionDate: PRIOR, status: 'voided' }),
      expect.objectContaining({ id: revealed, questionDate: DATE, status: 'revealed' }),
    ]);
  });
});
