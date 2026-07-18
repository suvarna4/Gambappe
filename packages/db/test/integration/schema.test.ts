/**
 * WS0-T3 integration AC: migrations apply on a fresh Postgres; factories insert a graded
 * question with 3 picks; key §5 constraints hold. Requires a live PG
 * (docker-compose / CI service); connection via TEST_DATABASE_URL or the dev default.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { uuidv7 } from 'uuidv7';
import { connect, type Db } from '../../src/client.js';
import type pg from 'pg';
import {
  analyticsEvents,
  picks,
  questions,
} from '../../src/schema/index.js';
import {
  buildGradedQuestionScenario,
  buildMarket,
  buildPick,
  buildQuestion,
  insertGradedQuestionScenario,
} from '../../src/testing/factories.js';
import { insertMarket, insertQuestion } from '../../src/repositories/questions.js';
import { getHeartbeats, recordJobStart, recordJobSuccess } from '../../src/repositories/heartbeats.js';

const url =
  process.env.TEST_DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts_test';


/** Drizzle wraps PG errors; assert on the SQLSTATE of the underlying cause. */
async function expectPgError(promise: Promise<unknown>, code: string): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (err) {
    caught = err;
  }
  expect(caught, 'expected query to fail').toBeDefined();
  const cause = (caught as { cause?: { code?: string } }).cause ?? caught;
  expect((cause as { code?: string }).code).toBe(code);
}

let pool: pg.Pool;
let db: Db;

beforeAll(async () => {
  ({ pool, db } = connect({ connectionString: url }));
  // Fresh schema every run (incl. the migrator's own bookkeeping schema).
  await db.execute(sql`DROP SCHEMA public CASCADE`);
  await db.execute(sql`CREATE SCHEMA public`);
  await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  const migrationsFolder = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'drizzle',
  );
  await migrate(db, { migrationsFolder });
});

afterAll(async () => {
  await pool.end();
});

describe('0001_init on fresh PG', () => {
  it('created the full §5 schema (spot-check core tables)', async () => {
    const res = await db.execute(sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type IN ('BASE TABLE')
    `);
    const names = res.rows.map((r) => r['table_name']);
    for (const required of [
      'profiles',
      'streak_freeze_uses',
      'users',
      'markets',
      'market_price_snapshots',
      'questions',
      'picks',
      'fingerprints',
      'ratings',
      'seasons',
      'nemesis_pairings',
      'pairing_questions',
      'rematch_requests',
      'duos',
      'duo_queue_entries',
      'duo_matches',
      'duo_match_questions',
      'placement_items',
      'placement_answers',
      'posts',
      'reactions',
      'blocks',
      'reports',
      'wallet_links',
      'notifications',
      'push_subscriptions',
      'audit_log',
      'job_heartbeats',
      'metric_rollups',
    ]) {
      expect(names, `missing table ${required}`).toContain(required);
    }
  });

  it('analytics_events is monthly-partitioned (§5.6)', async () => {
    const res = await db.execute(sql`
      SELECT count(*)::int AS n FROM pg_inherits
      WHERE inhparent = 'analytics_events'::regclass
    `);
    expect(Number(res.rows[0]?.['n'])).toBeGreaterThanOrEqual(2);
    // And rows land in a partition.
    await db.insert(analyticsEvents).values({
      ts: new Date(),
      event: 'spectator_view',
      props: {},
    });
    const count = await db.execute(sql`SELECT count(*)::int AS n FROM analytics_events`);
    expect(Number(count.rows[0]?.['n'])).toBe(1);
  });

  it('factories insert a graded question with 3 picks (WS0-T3 AC)', async () => {
    const scenario = await insertGradedQuestionScenario(db, buildGradedQuestionScenario());
    const stored = await db.select().from(picks);
    const forQuestion = stored.filter((p) => p.questionId === scenario.question.id);
    expect(forQuestion).toHaveLength(3);
    expect(forQuestion.filter((p) => p.result === 'win')).toHaveLength(2);
    expect(forQuestion.filter((p) => p.result === 'loss')).toHaveLength(1);
    for (const p of forQuestion) expect(p.edge).not.toBeNull();
  });

  it('enforces unique (question_id, profile_id) on picks (§5.3)', async () => {
    const scenario = await insertGradedQuestionScenario(db, buildGradedQuestionScenario());
    const dupe = buildPick(
      scenario.question.id as string,
      scenario.profiles[0].id as string,
    );
    await expectPgError(db.insert(picks).values(dupe), '23505');
  });

  it('enforces one daily per question_date (§5.3 partial unique)', async () => {
    const market = await insertMarket(db, buildMarket());
    await insertQuestion(db, buildQuestion(market.id, { questionDate: '2026-08-01' }));
    // Second daily on the same date → rejected.
    await expectPgError(
      insertQuestion(db, buildQuestion(market.id, { questionDate: '2026-08-01' })),
      '23505',
    );
    // But a bonus question on that date is fine (partial index scopes kind='daily').
    await insertQuestion(
      db,
      buildQuestion(market.id, { kind: 'nemesis_bonus', questionDate: '2026-08-01' }),
    );
  });

  it('enforces confidence bounds check (§5.3)', async () => {
    const market = await insertMarket(db, buildMarket());
    const question = await insertQuestion(db, buildQuestion(market.id, { questionDate: null }));
    const scenario = await insertGradedQuestionScenario(db, buildGradedQuestionScenario());
    await expectPgError(
      db.insert(picks).values(
        buildPick(question.id, scenario.profiles[0].id as string, { confidence: 40 }),
      ),
      '23514',
    );
  });

  it('question status enum + defaults behave', async () => {
    const market = await insertMarket(db, buildMarket());
    const q = buildQuestion(market.id, { questionDate: null, kind: 'duo_bonus' });
    delete (q as Record<string, unknown>)['status'];
    const inserted = await insertQuestion(db, q);
    expect(inserted.status).toBe('draft'); // §5.3 column default
    const [raw] = await db
      .select()
      .from(questions)
      .where(sql`${questions.id} = ${inserted.id}`);
    expect(raw?.yesCount).toBe(0);
    expect(raw?.noCount).toBe(0);
  });

  it('job_heartbeats upserts (§15.5)', async () => {
    const t1 = new Date('2026-07-19T08:00:00Z');
    const t2 = new Date('2026-07-19T08:00:05Z');
    await recordJobStart(db, 'maintenance:prune', t1);
    await recordJobSuccess(db, 'maintenance:prune', t2);
    const rows = await getHeartbeats(db);
    const hb = rows.find((r) => r.jobName === 'maintenance:prune');
    expect(hb?.lastStartedAt?.toISOString()).toBe(t1.toISOString());
    expect(hb?.lastSuccessAt?.toISOString()).toBe(t2.toISOString());
  });

  it('wallet_links partial unique: one active link per address hash (§5.6)', async () => {
    const scenario = await insertGradedQuestionScenario(db, buildGradedQuestionScenario());
    const [p1, p2] = scenario.profiles;
    const base = {
      addressHash: 'hash-abc',
      verifiedAt: new Date(),
      status: 'active' as const,
    };
    await db.execute(sql`
      INSERT INTO wallet_links (id, profile_id, address_hash, verified_at, status)
      VALUES (${uuidv7()}, ${p1.id}, ${base.addressHash}, ${base.verifiedAt}, ${base.status})
    `);
    await expectPgError(
      db.execute(sql`
        INSERT INTO wallet_links (id, profile_id, address_hash, verified_at, status)
        VALUES (${uuidv7()}, ${p2.id}, ${base.addressHash}, ${base.verifiedAt}, ${base.status})
      `),
      '23505',
    );
    // Unlinked rows with the same hash are allowed (cooldown record survives, §12.5).
    await db.execute(sql`
      INSERT INTO wallet_links (id, profile_id, address_hash, verified_at, status, unlinked_at)
      VALUES (${uuidv7()}, ${p2.id}, ${base.addressHash}, ${base.verifiedAt}, 'unlinked', now())
    `);
  });
});
