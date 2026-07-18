/**
 * WS10-T5 integration: the ops-dashboard queries (§15.5) against real Postgres — today's
 * question timeline window, the overdue-reveal filter (§16.1), and per-venue last price
 * update.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type pg from 'pg';
import { connect, type Db } from '../../src/client.js';
import { buildMarket, buildQuestion } from '../../src/testing/factories.js';
import { insertMarket, insertQuestion } from '../../src/repositories/questions.js';
import {
  getVenueLastPriceUpdate,
  listOverdueRevealQuestions,
  listQuestionsForWindow,
} from '../../src/repositories/ops-dashboard.js';

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
    migrationsFolder: join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'drizzle'),
  });
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await db.execute(sql`TRUNCATE questions, markets RESTART IDENTITY CASCADE`);
});

describe('listQuestionsForWindow (§15.5)', () => {
  it('returns only questions opening within the window, ordered by open_at', async () => {
    const market = await insertMarket(db, buildMarket());
    const inWindow2 = await insertQuestion(db, buildQuestion(market.id, { openAt: new Date('2026-07-20T14:00:00Z') }));
    const inWindow1 = await insertQuestion(db, buildQuestion(market.id, { openAt: new Date('2026-07-20T09:00:00Z') }));
    await insertQuestion(db, buildQuestion(market.id, { openAt: new Date('2026-07-21T09:00:00Z') })); // outside window

    const rows = await listQuestionsForWindow(
      db,
      new Date('2026-07-20T04:00:00Z'),
      new Date('2026-07-21T04:00:00Z'),
    );
    expect(rows.map((r) => r.id)).toEqual([inWindow1.id, inWindow2.id]);
  });
});

describe('listOverdueRevealQuestions (§16.1)', () => {
  it('returns only locked questions past reveal_at + threshold', async () => {
    const market = await insertMarket(db, buildMarket());
    const at = new Date('2026-07-20T12:00:00Z');

    const overdue = await insertQuestion(db, buildQuestion(market.id, {
      status: 'locked',
      revealAt: new Date('2026-07-20T10:00:00Z'), // 2h ago, past the 60min threshold
    }));
    await insertQuestion(db, buildQuestion(market.id, {
      status: 'locked',
      revealAt: new Date('2026-07-20T11:30:00Z'), // 30min ago, within threshold
    }));
    await insertQuestion(db, buildQuestion(market.id, {
      status: 'revealed',
      revealAt: new Date('2026-07-20T09:00:00Z'), // overdue window but already revealed
      revealedAt: new Date('2026-07-20T09:05:00Z'),
    }));

    const rows = await listOverdueRevealQuestions(db, at, 60);
    expect(rows.map((r) => r.id)).toEqual([overdue.id]);
  });
});

describe('getVenueLastPriceUpdate (§15.5)', () => {
  it('returns the max yes_price_updated_at per venue', async () => {
    await insertMarket(db, buildMarket({ venue: 'kalshi', yesPriceUpdatedAt: new Date('2026-07-20T09:00:00Z') }));
    await insertMarket(db, buildMarket({ venue: 'kalshi', yesPriceUpdatedAt: new Date('2026-07-20T11:00:00Z') }));
    await insertMarket(db, buildMarket({ venue: 'polymarket', yesPriceUpdatedAt: new Date('2026-07-20T08:00:00Z') }));

    const rows = await getVenueLastPriceUpdate(db);
    const byVenue = Object.fromEntries(rows.map((r) => [r.venue, r.lastUpdatedAt?.toISOString()]));
    expect(byVenue['kalshi']).toBe('2026-07-20T11:00:00.000Z');
    expect(byVenue['polymarket']).toBe('2026-07-20T08:00:00.000Z');
  });
});
