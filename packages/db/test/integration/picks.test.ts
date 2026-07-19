/**
 * WS3-T2 integration: `placePickTx`/`undoPickTx` (§6.2) against a real Postgres.
 *
 *  - Race test: two concurrent `placePickTx` calls for the SAME (question, profile) → exactly
 *    one row persists, the loser gets `already_picked` with the winner's row, and `yes_count` +
 *    `no_count` sum to 1 (never 2 — no double counter increment).
 *  - `QUESTION_LOCKED` guard: DB-clock-enforced (`lock_at > now()`), immune to the row's status
 *    OR a passed `lock_at`.
 *  - Undo: window + post-lock refusal, counters correct after undo, re-pick allowed after undo.
 *
 * Requires a live Postgres (docker-compose / CI service).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { uuidv7 } from 'uuidv7';
import type pg from 'pg';
import { connect, type Db } from '../../src/client.js';
import { placePickTx, undoPickTx } from '../../src/repositories/picks.js';
import { markets, picks, profiles, questions } from '../../src/schema/index.js';
import { buildMarket, buildProfile, buildQuestion } from '../../src/testing/index.js';

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

async function insertOpenQuestion(overrides: Parameters<typeof buildQuestion>[1] = {}) {
  const market = buildMarket();
  await db.insert(markets).values(market);
  const question = buildQuestion(market.id as string, { status: 'open', ...overrides });
  await db.insert(questions).values(question);
  return question;
}

describe('placePickTx (§6.2 steps 3+5)', () => {
  it('parallel same-profile picks → exactly one row persists, one wins, one gets already_picked', async () => {
    const question = await insertOpenQuestion();
    const profile = buildProfile();
    await db.insert(profiles).values(profile);

    const at = new Date(question.openAt!.getTime() + 60_000);
    const inputA = {
      id: uuidv7(),
      questionId: question.id as string,
      profileId: profile.id as string,
      side: 'yes' as const,
      yesPriceAtEntry: 0.6,
      priceStampedAt: at,
      pickedAt: at,
      source: 'web' as const,
    };
    const inputB = { ...inputA, id: uuidv7(), side: 'no' as const, yesPriceAtEntry: 0.61 };

    const [resultA, resultB] = await Promise.all([placePickTx(db, inputA), placePickTx(db, inputB)]);
    const outcomes = [resultA.outcome, resultB.outcome].sort();
    expect(outcomes).toEqual(['already_picked', 'inserted']);

    const rows = await db.select().from(picks).where(eq(picks.questionId, question.id as string));
    expect(rows).toHaveLength(1);

    const [after] = await db.select().from(questions).where(eq(questions.id, question.id as string));
    expect((after!.yesCount ?? 0) + (after!.noCount ?? 0)).toBe(1);
  });

  it('QUESTION_LOCKED when status is not open, even with a future lock_at', async () => {
    const question = await insertOpenQuestion({ status: 'locked' });
    const profile = buildProfile();
    await db.insert(profiles).values(profile);

    const result = await placePickTx(db, {
      id: uuidv7(),
      questionId: question.id as string,
      profileId: profile.id as string,
      side: 'yes',
      yesPriceAtEntry: 0.6,
      priceStampedAt: new Date(),
      pickedAt: new Date(),
      source: 'web',
    });
    expect(result.outcome).toBe('question_locked');
  });

  it('QUESTION_LOCKED when lock_at has passed, even though status is still open (worker-outage case, §5.7)', async () => {
    const past = new Date(Date.now() - 3_600_000);
    const question = await insertOpenQuestion({ status: 'open', lockAt: past });
    const profile = buildProfile();
    await db.insert(profiles).values(profile);

    const result = await placePickTx(db, {
      id: uuidv7(),
      questionId: question.id as string,
      profileId: profile.id as string,
      side: 'yes',
      yesPriceAtEntry: 0.6,
      priceStampedAt: new Date(),
      pickedAt: new Date(),
      source: 'web',
    });
    expect(result.outcome).toBe('question_locked');
  });

  it('parallel picks by DIFFERENT profiles never deadlock and count correctly (40P01 regression)', async () => {
    // Regression for the FOR SHARE → counter-UPDATE lock-upgrade deadlock: N overlapping
    // transactions on the SAME question row (the normal case — everyone picks the same daily
    // question). Under the old shape, any two overlapping picks deadlocked (reproduced as
    // Postgres 40P01); the guarded-UPDATE-first shape serializes on one exclusive row lock.
    const question = await insertOpenQuestion();
    const pickers = Array.from({ length: 8 }, () => buildProfile());
    await db.insert(profiles).values(pickers);

    const at = new Date(question.openAt!.getTime() + 60_000);
    const results = await Promise.all(
      pickers.map((p, i) =>
        placePickTx(db, {
          id: uuidv7(),
          questionId: question.id as string,
          profileId: p.id as string,
          side: i % 2 === 0 ? ('yes' as const) : ('no' as const),
          yesPriceAtEntry: 0.6,
          priceStampedAt: at,
          pickedAt: at,
          source: 'web' as const,
        }),
      ),
    );

    expect(results.map((r) => r.outcome)).toEqual(Array.from({ length: 8 }, () => 'inserted'));

    const [after] = await db.select().from(questions).where(eq(questions.id, question.id as string));
    expect(after!.yesCount).toBe(4);
    expect(after!.noCount).toBe(4);
  });

  it('increments the correct side counter', async () => {
    const question = await insertOpenQuestion();
    const [p1, p2] = [buildProfile(), buildProfile()];
    await db.insert(profiles).values([p1, p2]);

    await placePickTx(db, {
      id: uuidv7(),
      questionId: question.id as string,
      profileId: p1.id as string,
      side: 'yes',
      yesPriceAtEntry: 0.6,
      priceStampedAt: new Date(),
      pickedAt: new Date(),
      source: 'web',
    });
    await placePickTx(db, {
      id: uuidv7(),
      questionId: question.id as string,
      profileId: p2.id as string,
      side: 'no',
      yesPriceAtEntry: 0.6,
      priceStampedAt: new Date(),
      pickedAt: new Date(),
      source: 'web',
    });

    const [after] = await db.select().from(questions).where(eq(questions.id, question.id as string));
    expect(after!.yesCount).toBe(1);
    expect(after!.noCount).toBe(1);
  });
});

describe('undoPickTx (§6.2 undo)', () => {
  it('deletes within the window and decrements the counter; re-pick is allowed after', async () => {
    const question = await insertOpenQuestion();
    const profile = buildProfile();
    await db.insert(profiles).values(profile);

    const now = new Date();
    const placed = await placePickTx(db, {
      id: uuidv7(),
      questionId: question.id as string,
      profileId: profile.id as string,
      side: 'yes',
      yesPriceAtEntry: 0.6,
      priceStampedAt: now,
      pickedAt: now,
      source: 'web',
    });
    expect(placed.outcome).toBe('inserted');

    const undo = await undoPickTx(db, (placed as { outcome: 'inserted'; pick: { id: string } }).pick.id, profile.id as string, 60);
    expect(undo.outcome).toBe('deleted');

    const [after] = await db.select().from(questions).where(eq(questions.id, question.id as string));
    expect(after!.yesCount).toBe(0);

    const rePick = await placePickTx(db, {
      id: uuidv7(),
      questionId: question.id as string,
      profileId: profile.id as string,
      side: 'no',
      yesPriceAtEntry: 0.55,
      priceStampedAt: new Date(),
      pickedAt: new Date(),
      source: 'web',
    });
    expect(rePick.outcome).toBe('inserted');
  });

  it('UNDO_EXPIRED after the window elapses', async () => {
    const question = await insertOpenQuestion();
    const profile = buildProfile();
    await db.insert(profiles).values(profile);

    const longAgo = new Date(Date.now() - 3600_000);
    const placed = await placePickTx(db, {
      id: uuidv7(),
      questionId: question.id as string,
      profileId: profile.id as string,
      side: 'yes',
      yesPriceAtEntry: 0.6,
      priceStampedAt: longAgo,
      pickedAt: longAgo,
      source: 'web',
    });
    expect(placed.outcome).toBe('inserted');

    const undo = await undoPickTx(db, (placed as { outcome: 'inserted'; pick: { id: string } }).pick.id, profile.id as string, 60);
    expect(undo.outcome).toBe('expired');
  });

  it('UNDO_EXPIRED after lock_at has passed, even within the 60s window', async () => {
    const nearLock = new Date(Date.now() + 500);
    const question = await insertOpenQuestion({ lockAt: nearLock });
    const profile = buildProfile();
    await db.insert(profiles).values(profile);

    const placed = await placePickTx(db, {
      id: uuidv7(),
      questionId: question.id as string,
      profileId: profile.id as string,
      side: 'yes',
      yesPriceAtEntry: 0.6,
      priceStampedAt: new Date(),
      pickedAt: new Date(),
      source: 'web',
    });
    expect(placed.outcome).toBe('inserted');

    await new Promise((r) => setTimeout(r, 700)); // let lock_at pass

    const undo = await undoPickTx(db, (placed as { outcome: 'inserted'; pick: { id: string } }).pick.id, profile.id as string, 60);
    expect(undo.outcome).toBe('expired');
  });

  it('forbidden when the caller does not own the pick', async () => {
    const question = await insertOpenQuestion();
    const [owner, other] = [buildProfile(), buildProfile()];
    await db.insert(profiles).values([owner, other]);

    const placed = await placePickTx(db, {
      id: uuidv7(),
      questionId: question.id as string,
      profileId: owner.id as string,
      side: 'yes',
      yesPriceAtEntry: 0.6,
      priceStampedAt: new Date(),
      pickedAt: new Date(),
      source: 'web',
    });
    expect(placed.outcome).toBe('inserted');

    const undo = await undoPickTx(db, (placed as { outcome: 'inserted'; pick: { id: string } }).pick.id, other.id as string, 60);
    expect(undo.outcome).toBe('forbidden');
  });
});
