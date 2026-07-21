/**
 * `scheduleDailyQuestionLifecycle` (composer scheduling fix): WS14-T4's Question Zero drill
 * found that `POST /api/admin/questions` created a `scheduled` daily question but enqueued
 * nothing — zero `pgboss.job` rows — so the question sat inert forever (§5.3/§6.2). This
 * covers the fix at the same layer `settlement-admin.test.ts` covers force-settle's
 * `grade:followup` enqueue: call the lib function against a real pgboss schema and assert the
 * actual queued rows, exactly the check the drill ran (`check-scheduled-jobs.sh`).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type pg from 'pg';
import { connect, markets, questions, type Db } from '@receipts/db';
import { buildMarket, buildQuestion } from '@receipts/db/testing';
import { scheduleDailyQuestionLifecycle } from '@/lib/question-lifecycle-queue';
import { getBoss } from '@/lib/stores';

const dbUrl =
  process.env.TEST_DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts_test';

let pool: pg.Pool;
let db: Db;

beforeAll(async () => {
  process.env.DATABASE_URL = dbUrl; // getBoss() reads this
  ({ pool, db } = connect({ connectionString: dbUrl }));
  await db.execute(sql`DROP SCHEMA public CASCADE`);
  await db.execute(sql`CREATE SCHEMA public`);
  await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  await db.execute(sql`DROP SCHEMA IF EXISTS pgboss CASCADE`);
  await migrate(db, {
    migrationsFolder: join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'packages', 'db', 'drizzle'),
  });
});

afterAll(async () => {
  const boss = await getBoss();
  await boss.stop({ graceful: false });
  await pool.end();
});

beforeEach(async () => {
  await db.execute(sql`TRUNCATE questions, markets RESTART IDENTITY CASCADE`);
  // pgboss.job may not exist until the first getBoss() call; guard the cleanup accordingly.
  await db.execute(sql`DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'pgboss' AND table_name = 'job') THEN
      DELETE FROM pgboss.job;
    END IF;
  END $$`);
});

const NOW = new Date('2026-08-10T12:00:00Z');

describe('scheduleDailyQuestionLifecycle', () => {
  // WS23-T2 (D-J3): the third `reveal:fire` send is GONE (settle-on-resolution replaced the
  // clock-scheduled reveal ceremony) — this asserts ONLY question:open + question:lock are queued,
  // and that no orphan `reveal:fire` row is ever enqueued.
  it('enqueues question:open and question:lock at the question\'s lifecycle times (no reveal:fire)', async () => {
    const market = buildMarket();
    await db.insert(markets).values(market);
    const question = buildQuestion(market.id as string, {
      status: 'scheduled',
      openAt: new Date(NOW.getTime() + 60 * 60_000),
      lockAt: new Date(NOW.getTime() + 8 * 3600_000),
    });
    await db.insert(questions).values(question);

    await scheduleDailyQuestionLifecycle({
      id: question.id as string,
      openAt: question.openAt as Date,
      lockAt: question.lockAt as Date,
    });

    const jobs = await db.execute(
      sql`SELECT name, data, start_after FROM pgboss.job WHERE name IN ('question:open', 'question:lock') ORDER BY name`,
    );
    expect(jobs.rows).toHaveLength(2);

    const byName = new Map(jobs.rows.map((r) => [r['name'], r]));
    for (const [name, at] of [
      ['question:lock', question.lockAt as Date],
      ['question:open', question.openAt as Date],
    ] as const) {
      const row = byName.get(name);
      expect(row, name).toBeDefined();
      expect(row!['data'], name).toEqual({ questionId: question.id });
      expect(new Date(row!['start_after'] as string).getTime(), name).toBe(at.getTime());
    }

    // The settle pipeline (D-J3) means no reveal is ever clock-scheduled — assert the orphan
    // `reveal:fire` row this used to leave behind is gone.
    const revealJobs = await db.execute(
      sql`SELECT count(*)::int AS n FROM pgboss.job WHERE name = 'reveal:fire'`,
    );
    expect(revealJobs.rows[0]!['n']).toBe(0);
  });

  it('is safe to call twice — the lifecycle jobs are idempotent, so duplicate enqueues are harmless (§5.7)', async () => {
    const market = buildMarket();
    await db.insert(markets).values(market);
    const question = buildQuestion(market.id as string, { status: 'scheduled' });
    await db.insert(questions).values(question);

    const times = {
      id: question.id as string,
      openAt: question.openAt as Date,
      lockAt: question.lockAt as Date,
    };
    await scheduleDailyQuestionLifecycle(times);
    await expect(scheduleDailyQuestionLifecycle(times)).resolves.toBeUndefined();

    const jobs = await db.execute(
      sql`SELECT count(*)::int AS n FROM pgboss.job WHERE name IN ('question:open', 'question:lock')`,
    );
    // Four rows (two of each) is expected and fine — the handlers are status-guarded no-ops on
    // the second delivery; what matters is the call never throws and never drops a job.
    expect(jobs.rows[0]!['n']).toBe(4);
  });
});
