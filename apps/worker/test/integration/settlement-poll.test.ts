/**
 * WS1-T5 integration AC (§6.5, §7.5): a mock resolution grades a question — outcome/settledAt
 * copied, picks win/loss/edge correct against a hand-checked vector, `grade:followup`
 * enqueued in the SAME transaction — and a second poll of an already-graded/voided question
 * is a no-op (idempotent). Requires a live Postgres (docker-compose / CI service).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import PgBoss from 'pg-boss';
import type pg from 'pg';
import { connect, markets, picks, profiles, questions, type Db } from '@receipts/db';
import { buildMarket, buildPick, buildProfile, buildQuestion, computeEdge } from '@receipts/db/testing';
import { MockVenueAdapter } from '@receipts/venues/mock';
import { runSettlementPoll } from '../../src/jobs/settlement-poll.js';

const dbUrl =
  process.env.TEST_DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts_test';

const NOW = new Date('2026-07-19T15:00:00Z');

let pool: pg.Pool;
let db: Db;
let boss: PgBoss;

beforeAll(async () => {
  ({ pool, db } = connect({ connectionString: dbUrl }));
  await db.execute(sql`DROP SCHEMA public CASCADE`);
  await db.execute(sql`CREATE SCHEMA public`);
  await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  await db.execute(sql`DROP SCHEMA IF EXISTS pgboss CASCADE`);
  await migrate(db, {
    migrationsFolder: join(
      dirname(fileURLToPath(import.meta.url)),
      '..', '..', '..', '..', 'packages', 'db', 'drizzle',
    ),
  });

  boss = new PgBoss({ connectionString: dbUrl, schema: 'pgboss' });
  await boss.start();
  await boss.createQueue('grade:followup');
});

afterAll(async () => {
  await boss.stop({ graceful: false });
  await pool.end();
});

interface LockedScenario {
  questionId: string;
  marketId: string;
  venueMarketId: string;
  pickIds: { winA: string; winB: string; loss: string };
  entryPrices: { winA: number; winB: number; loss: number };
}

async function insertLockedScenario(venueMarketId: string): Promise<LockedScenario> {
  const market = buildMarket({ venue: 'kalshi', venueMarketId, status: 'closed' });
  await db.insert(markets).values(market);
  const question = buildQuestion(market.id as string, { status: 'locked' });
  await db.insert(questions).values(question);

  // Three distinct profiles (picks.profile_id FKs into profiles).
  const [profileA, profileB, profileC] = [buildProfile(), buildProfile(), buildProfile()];
  await db.insert(profiles).values([profileA, profileB, profileC]);

  // Two YES picks (different entry prices) and one NO pick — outcome will resolve 'yes'.
  const entryPrices = { winA: 0.6, winB: 0.7, loss: 0.55 };
  const winAPick = buildPick(question.id as string, profileA.id as string, {
    side: 'yes',
    yesPriceAtEntry: entryPrices.winA,
  });
  const winBPick = buildPick(question.id as string, profileB.id as string, {
    side: 'yes',
    yesPriceAtEntry: entryPrices.winB,
  });
  const lossPick = buildPick(question.id as string, profileC.id as string, {
    side: 'no',
    yesPriceAtEntry: entryPrices.loss,
  });
  await db.insert(picks).values([winAPick, winBPick, lossPick]);

  return {
    questionId: question.id as string,
    marketId: market.id as string,
    venueMarketId,
    pickIds: {
      winA: winAPick.id as string,
      winB: winBPick.id as string,
      loss: lossPick.id as string,
    },
    entryPrices,
  };
}

describe('settlement:poll — resolved (§6.5)', () => {
  let scenario: LockedScenario;

  beforeAll(async () => {
    scenario = await insertLockedScenario('SETTLE-RESOLVED-1');
  });

  it('grades the question and picks against a hand-checked vector', async () => {
    const adapter = new MockVenueAdapter('kalshi');
    adapter.addMarket({ venueMarketId: scenario.venueMarketId });
    adapter.resolve(scenario.venueMarketId, 'yes');

    const report = await runSettlementPoll(db, pool, boss, [adapter], NOW);
    expect(report.resolved).toBe(1);

    const q = await db.execute(
      sql`SELECT status, outcome, settled_at FROM questions WHERE id = ${scenario.questionId}`,
    );
    expect(q.rows[0]!['outcome']).toBe('yes');
    expect(q.rows[0]!['status']).toBe('locked'); // publication rule: reveal:fire (WS3-T4) flips this later
    expect(q.rows[0]!['settled_at']).not.toBeNull();

    const gradedPicks = await db.execute(
      sql`SELECT id, side, result, edge FROM picks WHERE question_id = ${scenario.questionId}`,
    );
    const bySide = new Map(gradedPicks.rows.map((r) => [r['id'] as string, r]));

    const winA = bySide.get(scenario.pickIds.winA)!;
    expect(winA['result']).toBe('win');
    expect(Number(winA['edge'])).toBeCloseTo(computeEdge('yes', scenario.entryPrices.winA, true), 5);

    const winB = bySide.get(scenario.pickIds.winB)!;
    expect(winB['result']).toBe('win');
    expect(Number(winB['edge'])).toBeCloseTo(computeEdge('yes', scenario.entryPrices.winB, true), 5);

    const loss = bySide.get(scenario.pickIds.loss)!;
    expect(loss['result']).toBe('loss');
    expect(Number(loss['edge'])).toBeCloseTo(computeEdge('no', scenario.entryPrices.loss, false), 5);
  });

  it('enqueued grade:followup transactionally with the questionId', async () => {
    const job = await db.execute(sql`
      SELECT data FROM pgboss.job WHERE name = 'grade:followup'
    `);
    expect(job.rows).toHaveLength(1);
    expect(job.rows[0]!['data']).toMatchObject({ questionId: scenario.questionId });
  });

  it('is idempotent — a second poll of the same resolved question is a no-op', async () => {
    const adapter = new MockVenueAdapter('kalshi');
    adapter.addMarket({ venueMarketId: scenario.venueMarketId });
    adapter.resolve(scenario.venueMarketId, 'yes');

    const before = await db.execute(
      sql`SELECT settled_at FROM questions WHERE id = ${scenario.questionId}`,
    );

    const report = await runSettlementPoll(db, pool, boss, [adapter], new Date(NOW.getTime() + 5 * 60_000));
    expect(report.resolved).toBe(0);
    expect(report.alreadyGraded).toBe(1);

    const after = await db.execute(
      sql`SELECT settled_at FROM questions WHERE id = ${scenario.questionId}`,
    );
    expect(after.rows[0]!['settled_at']).toEqual(before.rows[0]!['settled_at']);

    // No duplicate grade:followup enqueued.
    const jobs = await db.execute(sql`
      SELECT id FROM pgboss.job WHERE name = 'grade:followup'
    `);
    expect(jobs.rows).toHaveLength(1);
  });
});

describe('settlement:poll — voided (§6.5)', () => {
  it('voids the question and its pending picks, idempotently', async () => {
    const scenario = await insertLockedScenario('SETTLE-VOIDED-1');
    const adapter = new MockVenueAdapter('kalshi');
    adapter.addMarket({ venueMarketId: scenario.venueMarketId });
    adapter.void(scenario.venueMarketId);

    const report = await runSettlementPoll(db, pool, boss, [adapter], NOW);
    expect(report.voided).toBe(1);

    const q = await db.execute(sql`SELECT status FROM questions WHERE id = ${scenario.questionId}`);
    expect(q.rows[0]!['status']).toBe('voided');

    const votedPicks = await db.execute(
      sql`SELECT result, edge FROM picks WHERE question_id = ${scenario.questionId}`,
    );
    for (const row of votedPicks.rows) {
      expect(row['result']).toBe('void');
      expect(row['edge']).toBeNull();
    }

    // Idempotent re-run.
    const again = await runSettlementPoll(db, pool, boss, [adapter], NOW);
    expect(again.voided).toBe(0);
    expect(again.alreadyGraded).toBe(1);
  });
});

describe('settlement:poll — unresolved (§6.5)', () => {
  it('leaves the question untouched (no-op, retried next tick)', async () => {
    const scenario = await insertLockedScenario('SETTLE-UNRESOLVED-1');
    const adapter = new MockVenueAdapter('kalshi');
    adapter.addMarket({ venueMarketId: scenario.venueMarketId }); // never resolved

    const report = await runSettlementPoll(db, pool, boss, [adapter], NOW);
    expect(report.unresolved).toBe(1);

    const q = await db.execute(
      sql`SELECT status, outcome, settled_at FROM questions WHERE id = ${scenario.questionId}`,
    );
    expect(q.rows[0]!['status']).toBe('locked');
    expect(q.rows[0]!['outcome']).toBeNull();
    expect(q.rows[0]!['settled_at']).toBeNull();

    const pendingPicks = await db.execute(
      sql`SELECT result FROM picks WHERE question_id = ${scenario.questionId}`,
    );
    for (const row of pendingPicks.rows) {
      expect(row['result']).toBe('pending');
    }
  });
});
