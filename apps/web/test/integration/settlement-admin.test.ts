/**
 * WS10-T3 integration: `forceSettleQuestion`/`voidQuestionAdmin`/`regradeQuestion` (§15.3,
 * §6.5, §6.6) against a real Postgres + Redis. Covers the WBS AC directly: force-settle runs
 * the standard grading pipeline; regrade reverses streaks/percentiles correctly (before/after
 * assertions); pre-reveal void never touches streaks; post-reveal void replays them.
 *
 * Deep-regrade (rating restoration) is a documented no-op in this wave — see
 * `settlement-admin.ts`'s file header for why (no nemesis/duo bonus questions or rating
 * pipeline exist yet) — so it has nothing to assert here.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Redis } from 'ioredis';
import type pg from 'pg';
import {
  connect,
  getProfileById,
  getQuestionById,
  markets,
  notifications,
  picks,
  profiles,
  questions,
  type Db,
} from '@receipts/db';
import { buildMarket, buildPick, buildProfile, buildQuestion, computeEdge } from '@receipts/db/testing';
import { forceSettleQuestion, regradeQuestion, voidQuestionAdmin } from '@/lib/settlement-admin';
import { getBoss } from '@/lib/stores';

/** Matches `lib/percentile.ts`'s private `revealHashKey` format — apps/web can't import from
 * apps/worker (§4.2), and percentile.ts doesn't export this key builder, so it's reproduced
 * here rather than crossing that boundary for a test-only convenience. */
function revealHashKey(questionId: string): string {
  return `reveal:${questionId}`;
}

const dbUrl =
  process.env.TEST_DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts_test';
const redisUrl =
  process.env.TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6379';

let pool: pg.Pool;
let db: Db;
let redis: Redis;

beforeAll(async () => {
  process.env.DATABASE_URL = dbUrl; // getBoss() (force-settle's grade:followup enqueue) reads this
  ({ pool, db } = connect({ connectionString: dbUrl }));
  await db.execute(sql`DROP SCHEMA public CASCADE`);
  await db.execute(sql`CREATE SCHEMA public`);
  await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  await db.execute(sql`DROP SCHEMA IF EXISTS pgboss CASCADE`);
  await migrate(db, {
    migrationsFolder: join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'packages', 'db', 'drizzle'),
  });
  redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
  await redis.flushdb();
});

afterAll(async () => {
  const boss = await getBoss();
  await boss.stop({ graceful: false });
  await pool.end();
  redis.disconnect();
});

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE notifications, picks, questions, markets, profiles RESTART IDENTITY CASCADE`,
  );
  await redis.flushdb();
});

const NOW = new Date('2026-08-10T12:00:00Z');

describe('forceSettleQuestion (§15.3)', () => {
  it('rejects a question that is not locked', async () => {
    const market = buildMarket({ closeTime: new Date(NOW.getTime() - 3_600_000) });
    await db.insert(markets).values(market);
    const question = buildQuestion(market.id as string, { status: 'open' });
    await db.insert(questions).values(question);

    await expect(forceSettleQuestion(db, question.id as string, 'yes', NOW)).rejects.toThrow(
      /locked/,
    );
  });

  it('rejects force-settle less than FORCE_SETTLE_MIN_AFTER_CLOSE_MIN after market close', async () => {
    const market = buildMarket({ closeTime: new Date(NOW.getTime() - 10 * 60_000) }); // 10 min ago
    await db.insert(markets).values(market);
    const question = buildQuestion(market.id as string, { status: 'locked' });
    await db.insert(questions).values(question);

    await expect(forceSettleQuestion(db, question.id as string, 'yes', NOW)).rejects.toThrow(
      /30 minutes/,
    );
  });

  it('grades pending picks via the standard pipeline once ≥30min past close, and enqueues grade:followup', async () => {
    const market = buildMarket({ closeTime: new Date(NOW.getTime() - 31 * 60_000) }); // 31 min ago
    await db.insert(markets).values(market);
    const question = buildQuestion(market.id as string, { status: 'locked' });
    await db.insert(questions).values(question);
    const winner = buildProfile();
    const loser = buildProfile();
    await db.insert(profiles).values([winner, loser]);
    await db.insert(picks).values([
      buildPick(question.id as string, winner.id as string, { side: 'yes', yesPriceAtEntry: 0.6 }),
      buildPick(question.id as string, loser.id as string, { side: 'no', yesPriceAtEntry: 0.6 }),
    ]);

    const result = await forceSettleQuestion(db, question.id as string, 'yes', NOW);
    expect(result).toEqual({ graded: true, winCount: 1, lossCount: 1 });

    const settled = await getQuestionById(db, question.id as string);
    expect(settled?.outcome).toBe('yes');
    expect(settled?.status).toBe('locked'); // publication rule — reveal:fire owns the transition

    const jobs = await db.execute(
      sql`SELECT data FROM pgboss.job WHERE name = 'grade:followup' ORDER BY created_on DESC LIMIT 1`,
    );
    expect(jobs.rows).toHaveLength(1);
    expect(jobs.rows[0]!['data']).toEqual({ questionId: question.id });
  });

  it('is idempotent — a second force-settle call on an already-graded question is a no-op', async () => {
    const market = buildMarket({ closeTime: new Date(NOW.getTime() - 31 * 60_000) });
    await db.insert(markets).values(market);
    const question = buildQuestion(market.id as string, { status: 'locked' });
    await db.insert(questions).values(question);

    await forceSettleQuestion(db, question.id as string, 'yes', NOW);
    const second = await forceSettleQuestion(db, question.id as string, 'yes', NOW);
    expect(second).toEqual({ graded: false, winCount: 0, lossCount: 0 });
  });
});

describe('voidQuestionAdmin — pre-reveal (§15.3, §6.6)', () => {
  it('voids an open question and all its picks, with no streak replay needed', async () => {
    const market = buildMarket();
    await db.insert(markets).values(market);
    const question = buildQuestion(market.id as string, { status: 'open' });
    await db.insert(questions).values(question);
    const profile = buildProfile({ currentStreak: 5, lastCountedDate: '2026-08-09' });
    await db.insert(profiles).values(profile);
    await db.insert(picks).values(buildPick(question.id as string, profile.id as string));

    const result = await voidQuestionAdmin(db, question.id as string, 'admin correction', NOW);
    expect(result).toEqual({ voided: true, affectedProfileIds: [] });

    const voided = await getQuestionById(db, question.id as string);
    expect(voided?.status).toBe('voided');
    expect(voided?.voidReason).toBe('admin correction');

    const [pick] = await db.select().from(picks).where(sql`question_id = ${question.id}`);
    expect(pick?.result).toBe('void');

    // Never touched — §6.6: nothing mutates a streak before reveal.
    const unaffected = await getProfileById(db, profile.id as string);
    expect(unaffected?.currentStreak).toBe(5);
    expect(unaffected?.lastCountedDate).toBe('2026-08-09');
  });

  it('voids an already-graded (but not yet revealed) locked question\'s picks too', async () => {
    const market = buildMarket();
    await db.insert(markets).values(market);
    const question = buildQuestion(market.id as string, { status: 'locked', outcome: 'yes', settledAt: NOW });
    await db.insert(questions).values(question);
    const profile = buildProfile();
    await db.insert(profiles).values(profile);
    await db.insert(picks).values(
      buildPick(question.id as string, profile.id as string, { side: 'yes', result: 'win', edge: 0.4, gradedAt: NOW }),
    );

    await voidQuestionAdmin(db, question.id as string, 'wrong resolution', NOW);

    const [pick] = await db.select().from(picks).where(sql`question_id = ${question.id}`);
    expect(pick?.result).toBe('void');
    expect(pick?.edge).toBeNull();
  });

  it('rejects a question that is not in a voidable status', async () => {
    const market = buildMarket();
    await db.insert(markets).values(market);
    const question = buildQuestion(market.id as string, { status: 'voided' });
    await db.insert(questions).values(question);

    const result = await voidQuestionAdmin(db, question.id as string, 'x', NOW);
    expect(result.voided).toBe(false);
  });

  it('404s for an unknown question', async () => {
    await expect(
      voidQuestionAdmin(db, '00000000-0000-0000-0000-000000000000', 'x', NOW),
    ).rejects.toThrow();
  });
});

describe('voidQuestionAdmin — post-reveal (§5.7, §6.6 replay procedure)', () => {
  async function makeRevealedDailyWithStreak(opts: {
    questionDate: string;
    priorLastCountedDate: string;
    priorStreak: number;
  }) {
    const market = buildMarket({ status: 'resolved', outcome: 'yes' });
    await db.insert(markets).values(market);
    const revealedAt = new Date(`${opts.questionDate}T20:00:00Z`);
    const question = buildQuestion(market.id as string, {
      questionDate: opts.questionDate,
      status: 'revealed',
      outcome: 'yes',
      settledAt: new Date(`${opts.questionDate}T17:00:00Z`),
      revealedAt,
    });
    await db.insert(questions).values(question);
    const profile = buildProfile({
      currentStreak: opts.priorStreak,
      bestStreak: opts.priorStreak,
      lastCountedDate: opts.priorLastCountedDate,
    });
    await db.insert(profiles).values(profile);
    await db.insert(picks).values(
      buildPick(question.id as string, profile.id as string, {
        side: 'yes',
        yesPriceAtEntry: 0.6,
        result: 'win',
        edge: computeEdge('yes', 0.6, true),
        gradedAt: question.settledAt as Date,
      }),
    );
    return { question, profile, revealedAt };
  }

  it('voids the question, voids the pick, and replays the streak down (day no longer counts)', async () => {
    const { question, profile, revealedAt } = await makeRevealedDailyWithStreak({
      questionDate: '2026-08-09',
      priorLastCountedDate: '2026-08-08',
      priorStreak: 3,
    });
    const at = new Date(revealedAt.getTime() + 3600_000); // 1h after reveal — inside window

    const result = await voidQuestionAdmin(db, question.id as string, 'overturned', at);
    expect(result.voided).toBe(true);
    expect(result.affectedProfileIds).toEqual([profile.id]);

    const [pick] = await db.select().from(picks).where(sql`question_id = ${question.id}`);
    expect(pick?.result).toBe('void');

    // The profile no longer "answered" 08-09 (pick is void) — replay walks back to 08-08.
    const replayed = await getProfileById(db, profile.id as string);
    expect(replayed?.currentStreak).toBe(0); // no revealed daily on record for 08-08 either (fixture only has one daily) — the walk finds nothing to advance through, so it resets
    expect(replayed?.lastCountedDate).toBeNull();

    const notifs = await db.select().from(notifications).where(sql`profile_id = ${profile.id}`);
    expect(notifs).toHaveLength(1);
    expect(notifs[0]?.kind).toBe('question_voided');
  });

  it('rejects post-reveal void past REGRADE_WINDOW_H', async () => {
    const { question, revealedAt } = await makeRevealedDailyWithStreak({
      questionDate: '2026-08-09',
      priorLastCountedDate: '2026-08-08',
      priorStreak: 1,
    });
    const tooLate = new Date(revealedAt.getTime() + 49 * 3600_000); // 49h > 48h window

    await expect(voidQuestionAdmin(db, question.id as string, 'too late', tooLate)).rejects.toThrow(
      /48h/,
    );
  });
});

describe('regradeQuestion (§6.5, §6.6, §8.6)', () => {
  async function makeRevealedDaily(questionDate: string) {
    const market = buildMarket({ status: 'resolved', outcome: 'yes' });
    await db.insert(markets).values(market);
    const revealedAt = new Date(`${questionDate}T20:00:00Z`);
    const question = buildQuestion(market.id as string, {
      questionDate,
      status: 'revealed',
      outcome: 'yes',
      settledAt: new Date(`${questionDate}T17:00:00Z`),
      revealedAt,
    });
    await db.insert(questions).values(question);
    const winner = buildProfile({ currentWinStreak: 4, bestWinStreak: 4, currentStreak: 1, lastCountedDate: questionDate });
    const loser = buildProfile({ currentWinStreak: 0, bestWinStreak: 2, currentStreak: 1, lastCountedDate: questionDate });
    await db.insert(profiles).values([winner, loser]);
    await db.insert(picks).values([
      buildPick(question.id as string, winner.id as string, {
        side: 'yes',
        yesPriceAtEntry: 0.6,
        result: 'win',
        edge: computeEdge('yes', 0.6, true),
        gradedAt: question.settledAt as Date,
      }),
      buildPick(question.id as string, loser.id as string, {
        side: 'no',
        yesPriceAtEntry: 0.6,
        result: 'loss',
        edge: computeEdge('no', 0.6, false),
        gradedAt: question.settledAt as Date,
      }),
    ]);
    return { question, winner, loser, revealedAt };
  }

  it('rejects a question that is not revealed', async () => {
    const market = buildMarket();
    await db.insert(markets).values(market);
    const question = buildQuestion(market.id as string, { status: 'locked' });
    await db.insert(questions).values(question);

    await expect(regradeQuestion(db, redis, question.id as string, 'no', NOW)).rejects.toThrow(
      /revealed/,
    );
  });

  it('rejects regrade past REGRADE_WINDOW_H', async () => {
    const { question, revealedAt } = await makeRevealedDaily('2026-08-05');
    const tooLate = new Date(revealedAt.getTime() + 49 * 3600_000);
    await expect(regradeQuestion(db, redis, question.id as string, 'no', tooLate)).rejects.toThrow(
      /48h/,
    );
  });

  it('rejects regrading to the same outcome', async () => {
    const { question, revealedAt } = await makeRevealedDaily('2026-08-05');
    const at = new Date(revealedAt.getTime() + 3600_000);
    await expect(regradeQuestion(db, redis, question.id as string, 'yes', at)).rejects.toThrow(
      /nothing to regrade/,
    );
  });

  it('rejects regrade for a non-daily question kind (documented SPEC-GAP)', async () => {
    const market = buildMarket({ status: 'resolved', outcome: 'yes' });
    await db.insert(markets).values(market);
    const revealedAt = new Date('2026-08-05T20:00:00Z');
    const question = buildQuestion(market.id as string, {
      kind: 'nemesis_bonus',
      questionDate: null,
      status: 'revealed',
      outcome: 'yes',
      settledAt: new Date('2026-08-05T17:00:00Z'),
      revealedAt,
    });
    await db.insert(questions).values(question);
    const at = new Date(revealedAt.getTime() + 3600_000);

    await expect(regradeQuestion(db, redis, question.id as string, 'no', at)).rejects.toThrow(
      /only implemented for daily/,
    );
  });

  it('flips the outcome, reverses win/loss + win-streaks correctly, and recomputes percentiles', async () => {
    const { question, winner, loser, revealedAt } = await makeRevealedDaily('2026-08-05');
    const at = new Date(revealedAt.getTime() + 3600_000);

    const result = await regradeQuestion(db, redis, question.id as string, 'no', at);
    expect(result.regraded).toBe(true);
    expect(result.affectedProfileIds.sort()).toEqual([winner.id, loser.id].sort());

    const [winnerPick] = await db.select().from(picks).where(sql`profile_id = ${winner.id}`);
    const [loserPick] = await db.select().from(picks).where(sql`profile_id = ${loser.id}`);
    expect(winnerPick?.result).toBe('loss'); // picked yes, outcome now no → loss
    expect(loserPick?.result).toBe('win'); // picked no, outcome now no → win

    // Win streaks reverse: the former winner's win-streak resets to 0; the former loser's grows.
    const replayedWinner = await getProfileById(db, winner.id as string);
    const replayedLoser = await getProfileById(db, loser.id as string);
    expect(replayedWinner?.currentWinStreak).toBe(0);
    expect(replayedLoser?.currentWinStreak).toBe(1);
    // Participation streak is untouched by regrade — both still "answered" this date.
    expect(replayedWinner?.currentStreak).toBe(1);
    expect(replayedLoser?.currentStreak).toBe(1);

    const cachedPercentiles = await redis.hgetall(revealHashKey(question.id as string));
    expect(Object.keys(cachedPercentiles).sort()).toEqual([winner.id, loser.id].sort());

    const notifs = await db.select().from(notifications);
    expect(notifs.map((n) => n.kind)).toEqual(['question_regraded', 'question_regraded']);
  });
});
