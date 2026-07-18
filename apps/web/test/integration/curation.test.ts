/**
 * WS10-T2 integration: market browser, question composer, and preview routes against real
 * Postgres (§15.2). Exercises the full curator flow — browse a market, preview, submit, hit
 * the daily-duplicate conflict — the same path CurationClient.tsx drives in the browser.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type pg from 'pg';
import { uuidv7 } from 'uuidv7';
import { connect, insertMarket, type Db, type NewMarketRow } from '@receipts/db';

const dbUrl =
  process.env.TEST_DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts_test';

let pool: pg.Pool;
let db: Db;

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

  // Route modules read their Postgres pool from apps/web/lib/stores via module-level
  // globalThis caching, keyed off DATABASE_URL — point it at this migrated test instance.
  process.env.DATABASE_URL = dbUrl;
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await db.execute(sql`TRUNCATE questions, markets RESTART IDENTITY CASCADE`);
});

async function seedMarket(overrides: Partial<NewMarketRow> = {}) {
  return insertMarket(db, {
    id: uuidv7(),
    venue: 'kalshi',
    venueMarketId: `curation-test-${Math.random().toString(36).slice(2)}`,
    title: 'Will the Fed cut rates this month?',
    category: 'economics',
    closeTime: new Date('2026-07-20T18:00:00Z'),
    expectedResolveTime: new Date('2026-07-21T06:00:00Z'),
    status: 'open',
    yesPrice: 0.42,
    yesPriceUpdatedAt: new Date(),
    liquidityUsd: 5000,
    venueUrl: 'https://kalshi.com/markets/curation-test',
    nemesisEligible: false,
    raw: {},
    ...overrides,
  });
}

function getRequest(url: string): Request {
  return new Request(url);
}

function jsonRequest(url: string, method: string, body: unknown): Request {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('GET /api/admin/markets (§15.2)', () => {
  it('lists open markets soonest-closing first', async () => {
    const { GET } = await import('../../app/api/admin/markets/route.js');
    const soon = await seedMarket({ closeTime: new Date('2026-07-19T18:00:00Z') });
    await seedMarket({ closeTime: new Date('2026-07-25T18:00:00Z') });

    const res = await GET(getRequest('http://localhost/api/admin/markets'));
    const body = (await res.json()) as { data: { id: string }[] };
    expect(res.status).toBe(200);
    expect(body.data[0]?.id).toBe(soon.id);
    expect(body.data).toHaveLength(2);
  });

  it('filters by category and rejects an invalid one', async () => {
    const { GET } = await import('../../app/api/admin/markets/route.js');
    await seedMarket({ category: 'economics' });
    await seedMarket({ category: 'sports', venueMarketId: 'curation-test-sports' });

    const filtered = await GET(getRequest('http://localhost/api/admin/markets?category=sports'));
    const filteredBody = (await filtered.json()) as { data: { category: string }[] };
    expect(filteredBody.data).toHaveLength(1);
    expect(filteredBody.data[0]?.category).toBe('sports');

    const bad = await GET(getRequest('http://localhost/api/admin/markets?category=not-a-real-category'));
    expect(bad.status).toBe(400);
  });
});

describe('PATCH /api/admin/markets/[id] (§15.2)', () => {
  it('toggles nemesis_eligible and writes an audit_log row', async () => {
    const { PATCH } = await import('../../app/api/admin/markets/[id]/route.js');
    const { listAuditLog } = await import('@receipts/db');
    const market = await seedMarket();

    const res = await PATCH(
      jsonRequest(`http://localhost/api/admin/markets/${market.id}`, 'PATCH', {
        nemesis_eligible: true,
      }),
    );
    const body = (await res.json()) as { data: { nemesisEligible: boolean } };
    expect(res.status).toBe(200);
    expect(body.data.nemesisEligible).toBe(true);

    const rows = await listAuditLog(db, 1);
    expect(rows[0]?.action).toBe('market.tag');
  });

  it('404s for an unknown market id', async () => {
    const { PATCH } = await import('../../app/api/admin/markets/[id]/route.js');
    const missingId = '00000000-0000-0000-0000-000000000000';
    const res = await PATCH(
      jsonRequest(`http://localhost/api/admin/markets/${missingId}`, 'PATCH', {
        nemesis_eligible: true,
      }),
    );
    expect(res.status).toBe(404);
  });
});

describe('GET /api/admin/questions/preview (§15.2)', () => {
  it('returns a live preview with no errors for valid composer input', async () => {
    const { GET } = await import('../../app/api/admin/questions/preview/route.js');
    const market = await seedMarket();

    const params = new URLSearchParams({
      market_id: market.id,
      headline: 'Will the Fed cut rates?',
      yes_label: 'Cut',
      no_label: 'Hold',
      question_date: '2026-07-20',
    });
    const res = await GET(getRequest(`http://localhost/api/admin/questions/preview?${params}`));
    const body = (await res.json()) as { data: { question: { headline: string } | null; errors: string[] } };
    expect(res.status).toBe(200);
    expect(body.data.errors).toEqual([]);
    expect(body.data.question?.headline).toBe('Will the Fed cut rates?');
  });

  it('returns validation errors (not an HTTP error) for a business-rule violation', async () => {
    const { GET } = await import('../../app/api/admin/questions/preview/route.js');
    // close_time before the default lock_at for this question_date -> violates §15.2 ordering.
    const market = await seedMarket({ closeTime: new Date('2026-07-20T10:00:00Z') });

    const params = new URLSearchParams({ market_id: market.id, question_date: '2026-07-20' });
    const res = await GET(getRequest(`http://localhost/api/admin/questions/preview?${params}`));
    const body = (await res.json()) as { data: { question: unknown; errors: string[] } };
    expect(res.status).toBe(200);
    expect(body.data.question).toBeNull();
    expect(body.data.errors.length).toBeGreaterThan(0);
  });

  it('ignores an extra query param (e.g. the browser-nav ?token=) rather than rejecting', async () => {
    const { GET } = await import('../../app/api/admin/questions/preview/route.js');
    const market = await seedMarket();

    const params = new URLSearchParams({
      market_id: market.id,
      question_date: '2026-07-20',
      token: 'whatever-the-admin-auth-token-is',
    });
    const res = await GET(getRequest(`http://localhost/api/admin/questions/preview?${params}`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { errors: string[] } };
    expect(body.data.errors).not.toContain(expect.stringMatching(/token/i));
  });

  it('400s only for a missing/invalid market_id', async () => {
    const { GET } = await import('../../app/api/admin/questions/preview/route.js');
    const res = await GET(getRequest('http://localhost/api/admin/questions/preview'));
    expect(res.status).toBe(400);
  });
});

describe('POST /api/admin/questions (§15.2)', () => {
  it('creates a scheduled question and writes an audit_log row', async () => {
    const { POST } = await import('../../app/api/admin/questions/route.js');
    const { listAuditLog } = await import('@receipts/db');
    const market = await seedMarket();

    const res = await POST(
      jsonRequest('http://localhost/api/admin/questions', 'POST', {
        market_id: market.id,
        headline: 'Will the Fed cut rates?',
        blurb: null,
        yes_label: 'Cut',
        no_label: 'Hold',
        question_date: '2026-07-20',
        is_volatile: false,
        event_start_at: null,
      }),
    );
    const body = (await res.json()) as { data: { slug: string; status: string } };
    expect(res.status).toBe(201);
    expect(body.data.slug).toBe('2026-07-20-will-the-fed-cut-rates');
    expect(body.data.status).toBe('scheduled');

    const rows = await listAuditLog(db, 1);
    expect(rows[0]?.action).toBe('question.create');
  });

  it('404s when the market does not exist', async () => {
    const { POST } = await import('../../app/api/admin/questions/route.js');
    const res = await POST(
      jsonRequest('http://localhost/api/admin/questions', 'POST', {
        market_id: '00000000-0000-0000-0000-000000000000',
        headline: 'x',
        yes_label: 'Yes',
        no_label: 'No',
        question_date: '2026-07-20',
        is_volatile: false,
      }),
    );
    expect(res.status).toBe(404);
  });

  it('400s with VALIDATION_FAILED for a business-rule violation', async () => {
    const { POST } = await import('../../app/api/admin/questions/route.js');
    const market = await seedMarket({ closeTime: new Date('2026-07-20T10:00:00Z') });

    const res = await POST(
      jsonRequest('http://localhost/api/admin/questions', 'POST', {
        market_id: market.id,
        headline: 'Will the Fed cut rates?',
        yes_label: 'Cut',
        no_label: 'Hold',
        question_date: '2026-07-20',
        is_volatile: false,
      }),
    );
    const body = (await res.json()) as { error: { code: string } };
    expect(res.status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_FAILED');
  });

  it('409s with DUPLICATE_DAILY_QUESTION on a second daily question for the same date', async () => {
    const { POST } = await import('../../app/api/admin/questions/route.js');
    const first = await seedMarket();
    const second = await seedMarket({ venueMarketId: 'curation-test-second' });

    const makeBody = (marketId: string, headline: string) => ({
      market_id: marketId,
      headline,
      yes_label: 'Yes',
      no_label: 'No',
      question_date: '2026-07-20',
      is_volatile: false,
    });

    const ok = await POST(jsonRequest('http://localhost/api/admin/questions', 'POST', makeBody(first.id, 'First one')));
    expect(ok.status).toBe(201);

    const dup = await POST(jsonRequest('http://localhost/api/admin/questions', 'POST', makeBody(second.id, 'Second one')));
    const dupBody = (await dup.json()) as { error: { code: string } };
    expect(dup.status).toBe(409);
    expect(dupBody.error.code).toBe('DUPLICATE_DAILY_QUESTION');
  });
});
