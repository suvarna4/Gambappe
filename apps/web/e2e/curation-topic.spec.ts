import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { connect, markets, type Db } from '@receipts/db';
import { buildMarket } from '@receipts/db/testing';
import type pg from 'pg';

/**
 * WS18-T1 curation happy path: an admin "Publish as topic question" (POST
 * /api/admin/markets/:id/topic-question) creates an OPEN kind='topic' question that then surfaces
 * in the stack feed (GET /api/v1/stack). Driven through REAL HTTP routes against REAL Postgres,
 * the same wiring `admin-auth.spec.ts` and `golden-loop.spec.ts` use (admin stopgap token +
 * allowed IP; DB seeded directly, per §17.2). Markets are seeded with a future close_time so the
 * created topic is born `open`.
 *
 * The `topic_markets` flag is off in CI until WS23-T2 flips it, so the flow is split into two
 * flag-aware tests: the publish+feed happy path runs only when the server has the flag ON, and the
 * 404/empty-feed gate runs only when it's OFF. `FLAG_TOPIC_MARKETS` here mirrors the value the
 * webServer under test was booted with (playwright.config.ts env), so exactly one of the two runs.
 */
const TOKEN = 'e2e-test-stopgap-token';
const ALLOWED_IP = '127.0.0.1';
const FLAG_ON = process.env.FLAG_TOPIC_MARKETS === 'true' || process.env.FLAG_TOPIC_MARKETS === '1';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts';

let pool: pg.Pool;
let db: Db;

test.beforeAll(() => {
  ({ pool, db } = connect({ connectionString: DATABASE_URL }));
});

test.afterAll(async () => {
  await pool.end();
});

function adminHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { authorization: `Bearer ${TOKEN}`, 'x-forwarded-for': ALLOWED_IP, ...extra };
}

async function seedFutureMarket() {
  const unique = randomUUID().slice(0, 8);
  const market = buildMarket({
    venueMarketId: `kx-topic-e2e-${unique}`,
    category: 'economics',
    status: 'open',
    // Well in the future so the published topic opens now and locks later (stays in the feed).
    closeTime: new Date(Date.now() + 30 * 24 * 3600_000),
  });
  await db.insert(markets).values(market);
  return market;
}

test('publishes a topic question that appears in the stack feed', async ({ request }) => {
  test.skip(!FLAG_ON, 'topic_markets is off in this environment');
  const market = await seedFutureMarket();

  const publish = await request.post(`/api/admin/markets/${market.id}/topic-question`, {
    headers: adminHeaders({ 'content-type': 'application/json' }),
    data: { headline: 'Will the Fed cut rates this quarter?', yes_label: 'Cut', no_label: 'Hold' },
  });
  expect(publish.status()).toBe(201);
  const created = (await publish.json()) as { data: { slug: string; kind: string; status: string } };
  expect(created.data.kind).toBe('topic');
  expect(created.data.status).toBe('open');

  // The anonymous stack feed (all-categories default) now includes it.
  const feed = await request.get('/api/v1/stack');
  expect(feed.status()).toBe(200);
  const body = (await feed.json()) as { data: { topics: Array<{ slug: string }> } };
  expect(body.data.topics.some((t) => t.slug === created.data.slug)).toBe(true);
});

test('with topic_markets OFF, publish is 404 and the feed carries no topics', async ({ request }) => {
  test.skip(FLAG_ON, 'topic_markets is on in this environment');
  const market = await seedFutureMarket();

  const publish = await request.post(`/api/admin/markets/${market.id}/topic-question`, {
    headers: adminHeaders({ 'content-type': 'application/json' }),
    data: { headline: 'Should never publish' },
  });
  expect(publish.status()).toBe(404);

  const feed = await request.get('/api/v1/stack');
  expect(feed.status()).toBe(200);
  const body = (await feed.json()) as { data: { topics: unknown[] } };
  expect(body.data.topics).toEqual([]);
});
