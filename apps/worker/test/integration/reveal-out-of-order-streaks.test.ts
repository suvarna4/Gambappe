/**
 * Audit finding 9.1 (§6.6/§6.7): an OUT-OF-ORDER late reveal must never regress a
 * participant's streak fields.
 *
 * The failure chain this reconstructs (all through the real job/repo paths, no hand-seeded
 * streak state):
 *
 *   1. D−2's market lags unresolved (daily stays `locked`, `settled_at` null).
 *   2. D−1 VOIDS via `voidQuestionTx` — which has no prior-day gate, so the void succeeds with
 *      D−2 still unsettled, breaking the induction `reveal:fire`'s D−1-only ordering assertion
 *      relies on.
 *   3. D settles and reveals (its prior-day check sees D−1 = voided → passes); participants
 *      advance to `last_counted_date = D`.
 *   4. D−2 finally settles (`gradeResolvedQuestionTx`) and reveals late (its prior-day check
 *      sees D−3 = revealed → passes).
 *
 * Before the fix, step 4 replayed history bounded to D−2 and wrote the result unconditionally —
 * clobbering `last_counted_date` (and every derived field) BACKWARDS, with no self-heal for
 * active participants (they are not `streak:sweep` candidates: `last_counted_date` is not
 * `< targetDate`). The fix (`replayInputHistory`, `packages/db/src/repositories/streaks.ts`)
 * replays through `max(questionDate, profile.last_counted_date)` over the now-complete history,
 * so the late day's contribution is INCORPORATED into the chain while the watermark never moves
 * backwards.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Redis } from 'ioredis';
import PgBoss from 'pg-boss';
import type pg from 'pg';
import {
  connect,
  gradeResolvedQuestionTx,
  markets,
  picks,
  profiles,
  questions,
  streakFreezeUses,
  voidQuestionTx,
  type Db,
} from '@receipts/db';
import { buildMarket, buildPick, buildProfile, buildQuestion, computeEdge } from '@receipts/db/testing';
import { runRevealFire } from '../../src/jobs/reveal-fire.js';

const dbUrl =
  process.env.TEST_DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts_test';
const redisUrl =
  process.env.TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6379';

let pool: pg.Pool;
let db: Db;
let redis: Redis;
let boss: PgBoss;

beforeAll(async () => {
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

  boss = new PgBoss({ connectionString: dbUrl, schema: 'pgboss' });
  await boss.start();
  await boss.createQueue('reveal:fire');
});

afterAll(async () => {
  await boss.stop({ graceful: false });
  await pool.end();
  redis.disconnect();
});

/** A graded (settled, picks win/loss) but still-`locked` daily — ready for `reveal:fire`. */
async function insertGradedDaily(opts: {
  questionDate: string;
  picksSpec: Array<{ profile: ReturnType<typeof buildProfile>; side: 'yes' | 'no'; won: boolean }>;
}) {
  const market = buildMarket({ status: 'resolved', outcome: 'yes' });
  await db.insert(markets).values(market);
  const question = buildQuestion(market.id as string, {
    questionDate: opts.questionDate,
    status: 'locked',
    outcome: 'yes',
    settledAt: new Date(`${opts.questionDate}T17:00:00Z`),
    revealAt: new Date(`${opts.questionDate}T20:00:00Z`),
    crowdYesAtLock: opts.picksSpec.filter((p) => p.side === 'yes').length,
    crowdNoAtLock: opts.picksSpec.filter((p) => p.side === 'no').length,
  });
  await db.insert(questions).values(question);
  for (const spec of opts.picksSpec) {
    await db.insert(profiles).values(spec.profile).onConflictDoNothing();
    await db.insert(picks).values(
      buildPick(question.id as string, spec.profile.id as string, {
        side: spec.side,
        yesPriceAtEntry: 0.5,
        result: spec.won ? 'win' : 'loss',
        edge: computeEdge(spec.side, 0.5, spec.won),
        gradedAt: new Date(`${opts.questionDate}T17:00:00Z`),
      }),
    );
  }
  return question;
}

describe('reveal:fire out of order (audit 9.1 — monotonic streak write)', () => {
  it('a late reveal of an older day is incorporated into the streak and never regresses last_counted_date / streak fields', async () => {
    // Two participants pick every day. On the lagging day (11-02, outcome YES) `winner` picks
    // YES (a win once graded) and `loser` picks NO (a loss) — so the fix's effect is visible on
    // both the participation fields and the win-streak fields.
    const winner = buildProfile();
    const loser = buildProfile();
    await db.insert(profiles).values([winner, loser]);

    // D−4 (10-31) and D−3 (11-01): revealed in order through the real reveal path.
    const day0 = await insertGradedDaily({
      questionDate: '2026-10-31',
      picksSpec: [
        { profile: winner, side: 'yes', won: true },
        { profile: loser, side: 'yes', won: true },
      ],
    });
    expect((await runRevealFire(db, pool, boss, day0.id as string, new Date('2026-10-31T20:00:01Z'))).status).toBe('revealed');

    const day1 = await insertGradedDaily({
      questionDate: '2026-11-01',
      picksSpec: [
        { profile: winner, side: 'yes', won: true },
        { profile: loser, side: 'yes', won: true },
      ],
    });
    expect((await runRevealFire(db, pool, boss, day1.id as string, new Date('2026-11-01T20:00:01Z'))).status).toBe('revealed');

    // D−2 (11-02): the LAGGING day — locked, market unresolved, picks still pending.
    const lagMarket = buildMarket({ status: 'closed' });
    await db.insert(markets).values(lagMarket);
    const lagDay = buildQuestion(lagMarket.id as string, {
      questionDate: '2026-11-02',
      status: 'locked',
      settledAt: null,
      revealAt: new Date('2026-11-02T20:00:00Z'),
    });
    await db.insert(questions).values(lagDay);
    await db.insert(picks).values([
      buildPick(lagDay.id as string, winner.id as string, { side: 'yes', yesPriceAtEntry: 0.5, result: 'pending' }),
      buildPick(lagDay.id as string, loser.id as string, { side: 'no', yesPriceAtEntry: 0.5, result: 'pending' }),
    ]);

    // D−1 (11-03) voids through the REAL void path — `voidQuestionTx` has no prior-day gate, so
    // this succeeds with 11-02 still unsettled. This is exactly the induction break the audit
    // describes: 11-04's D−1-only ordering assertion will now pass over the hole at 11-02.
    const voidMarket = buildMarket({ status: 'voided' });
    await db.insert(markets).values(voidMarket);
    const voidDay = buildQuestion(voidMarket.id as string, {
      questionDate: '2026-11-03',
      status: 'locked',
      settledAt: null,
    });
    await db.insert(questions).values(voidDay);
    const voidResult = await voidQuestionTx(db, voidDay.id as string, new Date('2026-11-03T18:00:00Z'));
    expect(voidResult.voided).toBe(true);

    // D (11-04): settles and reveals AHEAD of 11-02 — the prior-day check sees 11-03 = voided
    // and passes.
    const dayD = await insertGradedDaily({
      questionDate: '2026-11-04',
      picksSpec: [
        { profile: winner, side: 'yes', won: true },
        { profile: loser, side: 'yes', won: true },
      ],
    });
    const outcomeD = await runRevealFire(db, pool, boss, dayD.id as string, new Date('2026-11-04T20:00:01Z'));
    expect(outcomeD).toMatchObject({ status: 'revealed', participantCount: 2 });

    // Both profiles are now counted through D: 10-31, 11-01, [11-02 invisible], 11-03 void,
    // 11-04 → streak 3 (the unrevealed 11-02 is not in the replay's history yet, and the gap
    // walk (11-01, 11-04) sees no revealed non-void day, so nothing breaks).
    for (const p of [winner, loser]) {
      const [row] = await db.select().from(profiles).where(eq(profiles.id, p.id));
      expect(row!.currentStreak).toBe(3);
      expect(row!.bestStreak).toBe(3);
      expect(row!.lastCountedDate).toBe('2026-11-04');
      expect(row!.currentWinStreak).toBe(3);
      expect(row!.bestWinStreak).toBe(3);
    }

    // 11-02 finally settles (real grading path) and reveals LATE — its own prior-day check sees
    // 11-01 = revealed and passes.
    const graded = await gradeResolvedQuestionTx(db, lagDay.id as string, 'yes', new Date('2026-11-05T08:00:00Z'));
    expect(graded).toMatchObject({ graded: true, winCount: 1, lossCount: 1 });
    const outcomeLate = await runRevealFire(db, pool, boss, lagDay.id as string, new Date('2026-11-05T09:00:00Z'));
    expect(outcomeLate).toMatchObject({ status: 'revealed', participantCount: 2 });

    // THE FIX'S CONTRACT — assert per profile:
    //
    // `winner` (11-02 pick was a win): the late day joins the chain. Full replay over the
    // now-complete history: 10-31 (1) → 11-01 (2) → 11-02 (3) → 11-03 void (advances) →
    // 11-04 (4). Nothing regresses; everything grows.
    const [winnerAfter] = await db.select().from(profiles).where(eq(profiles.id, winner.id));
    expect(winnerAfter!.lastCountedDate).toBe('2026-11-04'); // unfixed code wrote '2026-11-02'
    expect(winnerAfter!.currentStreak).toBe(4); // unfixed: 3 — D's counted day was dropped
    expect(winnerAfter!.bestStreak).toBe(4);
    expect(winnerAfter!.currentWinStreak).toBe(4);
    expect(winnerAfter!.bestWinStreak).toBe(4);

    // `loser` (11-02 pick was a loss): participation fields grow identically (a loss still
    // counts as participation, §6.6). Win-streak fields become the §6.6-CANONICAL values for
    // the now-complete history — W, W, L, void, W → current run 1, best run 2. best_win_streak
    // drops from the provisional 3 (computed while 11-02 was invisible) to 2: that is the same
    // truth-restoring rewrite a merge/regrade full replay would produce, not a truncation
    // artifact. Unfixed code instead wrote current_win_streak 0 (replay cut off at the 11-02
    // loss) and last_counted_date '2026-11-02'.
    const [loserAfter] = await db.select().from(profiles).where(eq(profiles.id, loser.id));
    expect(loserAfter!.lastCountedDate).toBe('2026-11-04');
    expect(loserAfter!.currentStreak).toBe(4);
    expect(loserAfter!.bestStreak).toBe(4);
    expect(loserAfter!.currentWinStreak).toBe(1); // the 11-04 win, after the 11-02 loss
    expect(loserAfter!.bestWinStreak).toBe(2);

    // No spurious freeze activity: the anomalous-path gap walk (last_counted_date=11-04 >
    // throughDate=11-02) is empty, and nobody actually missed a counted day.
    const freezeRows = await db.select().from(streakFreezeUses);
    expect(freezeRows).toHaveLength(0);
    expect(winnerAfter!.freezeBank).toBe(0);
    expect(loserAfter!.freezeBank).toBe(0);

    // The late day itself is properly revealed.
    const [lagAfter] = await db.select().from(questions).where(eq(questions.id, lagDay.id as string));
    expect(lagAfter!.status).toBe('revealed');
  });
});
