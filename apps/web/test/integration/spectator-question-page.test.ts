/**
 * WS8-T3 integration: the `/q/[slug]` spectator page scaffold against real Postgres (design
 * doc §10.1, §10.2, INV-10).
 *
 * The core guarantee under test is INV-10 / §10.2: "Server render contains zero viewer
 * data — identical HTML for every visitor," and specifically that "the CDN/ISR cache key for
 * public routes must ignore all cookies (a returning ghost's `rcpt_gid` must not fragment the
 * cache." `loadQuestionPageView` (what the page's server component calls) has NO
 * request/headers/cookies parameter in its signature — there is nothing here a cookie COULD
 * vary, so there is nothing for a cache key to fragment on if a CDN wrongly keyed on it. This
 * test proves that structurally (calling it twice, with nothing but the slug, yields
 * byte-identical output) rather than by diffing raw HTTP responses, since driving a real
 * `next start` + CDN-cache-key simulation is WS14-T2 (load tests) territory, not this task's
 * unit/integration layer. See `e2e/spectator-cache-key.spec.ts` for the complementary
 * real-HTTP proof (identical response with/without a `rcpt_gid` cookie) on the 404 path,
 * which is the one exercisable without seeding e2e-only fixtures.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { connect, type Db } from '@receipts/db';
import { insertGradedQuestionScenario } from '@receipts/db/testing';
import { ISR_REVALIDATE_QUESTION_S } from '@receipts/core';
import type pg from 'pg';

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
  process.env.DATABASE_URL = dbUrl;
});

afterAll(async () => {
  await pool.end();
});

describe('loadQuestionPageView (§10.2 INV-10 scaffold)', () => {
  it('returns null for an unknown slug', async () => {
    const { loadQuestionPageView } = await import('../../lib/spectator/question-page-view.js');
    expect(await loadQuestionPageView('does-not-exist')).toBeNull();
  });

  it('returns the public shape with crowd hidden for an open question (§9.3)', async () => {
    const { buildMarket, buildQuestion } = await import('@receipts/db/testing');
    const { insertMarket, insertQuestion } = await import('@receipts/db');
    const market = buildMarket();
    await insertMarket(db, market);
    const question = buildQuestion(market.id as string, { status: 'open' });
    await insertQuestion(db, question);

    const { loadQuestionPageView } = await import('../../lib/spectator/question-page-view.js');
    const view = await loadQuestionPageView(question.slug!);
    expect(view).not.toBeNull();
    expect(view!.status).toBe('open');
    // §9.3: crowd split hidden while open, no exceptions.
    expect(view!.crowd).toBeNull();
  });

  it('returns crowd once revealed, and is byte-identical across repeated calls with no request-shaped input', async () => {
    const { question } = await insertGradedQuestionScenario(db);
    const { loadQuestionPageView } = await import('../../lib/spectator/question-page-view.js');

    const first = await loadQuestionPageView(question.slug!);
    const second = await loadQuestionPageView(question.slug!);
    expect(first).not.toBeNull();
    expect(first!.crowd).not.toBeNull();
    // Nothing about the call site could have varied by "identity" (no cookie/header param
    // exists to pass) — this is the structural half of the §10.2 cache-key guarantee.
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('takes exactly one (slug) parameter — no request/headers/cookies input to vary on', async () => {
    const { loadQuestionPageView } = await import('../../lib/spectator/question-page-view.js');
    // TypeScript already enforces the signature at every call site above; this pins the
    // runtime arity too, so a future edit that widens the signature (e.g. to accept a
    // request for "just this one extra thing") fails a test, not just a review comment.
    expect(loadQuestionPageView.length).toBe(1);
  });
});

describe('/q/[slug] page module (§10.1 ISR config)', () => {
  it('exports revalidate = ISR_REVALIDATE_QUESTION_S (30s, §10.1 route table)', async () => {
    const page = await import('../../app/q/[slug]/page.js');
    expect(page.revalidate).toBe(ISR_REVALIDATE_QUESTION_S);
    expect(page.revalidate).toBe(30);
  });
});
