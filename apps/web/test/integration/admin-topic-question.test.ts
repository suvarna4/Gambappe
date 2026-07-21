/**
 * WS18-T1 integration: `POST /api/admin/markets/:id/topic-question` ("Publish as topic question")
 * against real Postgres + pg-boss, the same path CurationClient.tsx drives. Covers the happy path
 * (creates an OPEN `kind='topic'` question with `open_at=now`, `lock_at=close_time`, the
 * `{date}-{venueMarketId}` slug, and an audit row), the flag gate (off → 404), and the
 * already-closed-market rejection. Mirrors `curation.test.ts`'s real-boss teardown.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type pg from 'pg';
import { uuidv7 } from 'uuidv7';
import { setTestClock } from '@receipts/core';
import { connect, insertMarket, listAuditLog, type Db, type NewMarketRow } from '@receipts/db';

const dbUrl = process.env.TEST_DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts_test';

let pool: pg.Pool;
let db: Db;

beforeAll(async () => {
  setTestClock('2026-07-20T06:00:00Z');
  ({ pool, db } = connect({ connectionString: dbUrl }));
  await db.execute(sql`DROP SCHEMA public CASCADE`);
  await db.execute(sql`CREATE SCHEMA public`);
  await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  await migrate(db, {
    migrationsFolder: join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'packages', 'db', 'drizzle'),
  });
  process.env.DATABASE_URL = dbUrl;
});

afterAll(async () => {
  const { getBoss } = await import('@/lib/stores');
  const boss = await getBoss();
  await boss.stop({ graceful: false });
  await pool.end();
  setTestClock(null);
});

beforeEach(async () => {
  await db.execute(sql`TRUNCATE questions, markets, audit_log RESTART IDENTITY CASCADE`);
  delete process.env.FLAG_TOPIC_MARKETS;
});

async function seedMarket(overrides: Partial<NewMarketRow> = {}) {
  return insertMarket(db, {
    id: uuidv7(),
    venue: 'kalshi',
    venueMarketId: `topic-test-${Math.random().toString(36).slice(2, 8)}`,
    title: 'Will the Fed cut rates this month?',
    category: 'economics',
    closeTime: new Date('2026-07-25T18:00:00Z'),
    expectedResolveTime: new Date('2026-07-25T20:00:00Z'),
    status: 'open',
    yesPrice: 0.42,
    yesPriceUpdatedAt: new Date('2026-07-20T05:00:00Z'),
    liquidityUsd: 5000,
    venueUrl: 'https://kalshi.com/markets/topic-test',
    nemesisEligible: false,
    raw: {},
    ...overrides,
  });
}

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function post(marketId: string, body: unknown) {
  const { POST } = await import('../../app/api/admin/markets/[id]/topic-question/route.js');
  return POST(jsonRequest(`http://localhost/api/admin/markets/${marketId}/topic-question`, body));
}

describe('POST /api/admin/markets/:id/topic-question (WS18-T1)', () => {
  it('flag ON: creates an OPEN topic question with lock_at=close_time and an audit row', async () => {
    process.env.FLAG_TOPIC_MARKETS = 'true';
    const market = await seedMarket({ venueMarketId: 'kx-fed-cut' });

    const res = await post(market.id, { headline: 'Will the Fed cut in July?', yes_label: 'Cut', no_label: 'Hold' });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      data: {
        kind: string;
        status: string;
        questionDate: string | null;
        slug: string;
        lockAt: string;
        yesLabel: string;
      };
    };
    expect(body.data.kind).toBe('topic');
    expect(body.data.status).toBe('open');
    expect(body.data.questionDate).toBeNull();
    expect(body.data.slug).toBe('2026-07-20-kx-fed-cut');
    expect(new Date(body.data.lockAt).toISOString()).toBe(market.closeTime.toISOString());
    expect(body.data.yesLabel).toBe('Cut');

    const audit = await listAuditLog(db, 1);
    expect(audit[0]?.action).toBe('topic_question.create');
  });

  it('defaults yes/no labels to Yes/No when omitted', async () => {
    process.env.FLAG_TOPIC_MARKETS = 'true';
    const market = await seedMarket();
    const res = await post(market.id, { headline: 'Evergreen topic?' });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { yesLabel: string; noLabel: string } };
    expect(body.data.yesLabel).toBe('Yes');
    expect(body.data.noLabel).toBe('No');
  });

  it('flag OFF: 404, and no question is created', async () => {
    const market = await seedMarket();
    const res = await post(market.id, { headline: 'Should not publish' });
    expect(res.status).toBe(404);
    const rows = await db.execute(sql`SELECT count(*)::int AS n FROM questions`);
    expect((rows.rows[0] as { n: number }).n).toBe(0);
  });

  it('rejects a market whose close_time is already in the past (400)', async () => {
    process.env.FLAG_TOPIC_MARKETS = 'true';
    const market = await seedMarket({ closeTime: new Date('2026-07-19T18:00:00Z') });
    const res = await post(market.id, { headline: 'Too late' });
    expect(res.status).toBe(400);
  });

  it('404s for an unknown market id', async () => {
    process.env.FLAG_TOPIC_MARKETS = 'true';
    const res = await post('00000000-0000-0000-0000-000000000000', { headline: 'No market' });
    expect(res.status).toBe(404);
  });
});
