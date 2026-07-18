/**
 * WS5-T1 integration test: the §5.7/§14.3 mid-week pairing exit rule
 * (`apps/worker/src/lib/pairing-lifecycle.ts`) against a real Postgres.
 *
 *   - no shared question graded yet → `cancelled`, no rating change.
 *   - ≥1 shared question graded → early conclusion: scored on graded questions only, rating
 *     applied immediately (idempotency guard stamped), neutral notification both sides — a
 *     losing player cannot erase a loss by exiting (the integrity-critical rule the design
 *     doc's red-team pass called out, §14.3).
 *   - the "full" shared-question derivation counts BOTH the week's derived dailies AND the
 *     pairing's nemesis_bonus questions (the gap in WS11-T3's `getPairingSharedQuestionPicks`,
 *     which only covers bonus — see `packages/db/src/repositories/nemesis.ts`'s
 *     `getFullPairingSharedQuestionPicks` doc comment).
 *   - idempotent: a non-`active` pairing (already concluded) is a no-op.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { uuidv7 } from 'uuidv7';
import type pg from 'pg';
import {
  connect,
  markets,
  nemesisPairings,
  notifications,
  pairingQuestions,
  picks,
  profiles,
  questions,
  ratings,
  seasons,
  type Db,
  type ProfileRow,
} from '@receipts/db';
import { buildMarket, buildPick, buildProfile, buildQuestion } from '@receipts/db/testing';
import { applyPairingMidWeekExit, applyPairingMidWeekExitForProfile } from '../../src/lib/pairing-lifecycle.js';

const dbUrl = process.env.TEST_DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts_test';

const WEEK_START = '2026-07-20';
const AT = new Date('2026-07-22T15:00:00Z'); // mid-week (Wednesday)

let pool: pg.Pool;
let db: Db;

beforeAll(async () => {
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
  await pool.end();
});

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE TABLE nemesis_pairings, pairing_questions, seasons, notifications, ratings, picks, questions, markets, profiles CASCADE`,
  );
});

async function makeClaimedProfile(overrides: Partial<ProfileRow> = {}): Promise<ProfileRow> {
  const row = buildProfile({ kind: 'claimed', status: 'active', ...overrides });
  const [inserted] = await db.insert(profiles).values(row).returning();
  return inserted!;
}

async function makeSeason(): Promise<string> {
  const id = uuidv7();
  await db.insert(seasons).values({ id, kind: 'nemesis', startsOn: WEEK_START, endsOn: '2026-10-11', name: 'S' });
  return id;
}

async function makeActivePairing(seasonId: string, aId: string, bId: string): Promise<string> {
  const id = uuidv7();
  const [profileAId, profileBId] = aId < bId ? [aId, bId] : [bId, aId];
  await db.insert(nemesisPairings).values({
    id,
    seasonId,
    weekStart: WEEK_START,
    profileAId,
    profileBId,
    status: 'active',
    isRematch: false,
  });
  return id;
}

/** A daily question within the pairing's week. */
async function makeDailyInWeek(questionDate: string, opts: { revealed: boolean }): Promise<string> {
  const market = buildMarket({ status: opts.revealed ? 'resolved' : 'open', outcome: opts.revealed ? 'yes' : undefined });
  await db.insert(markets).values(market);
  const question = buildQuestion(market.id as string, {
    questionDate,
    status: opts.revealed ? 'revealed' : 'open',
    outcome: opts.revealed ? 'yes' : null,
    settledAt: opts.revealed ? AT : null,
    revealedAt: opts.revealed ? AT : null,
  });
  await db.insert(questions).values(question);
  return question.id as string;
}

async function addPick(questionId: string, profileId: string, opts: { side: 'yes' | 'no'; result: 'win' | 'loss'; edge: number }): Promise<void> {
  await db.insert(picks).values(
    buildPick(questionId, profileId, { side: opts.side, result: opts.result, edge: opts.edge, gradedAt: AT }),
  );
}

describe('applyPairingMidWeekExit — no shared question graded yet → cancelled (§5.7)', () => {
  it('cancels with no rating change and a neutral notification for both sides', async () => {
    const a = await makeClaimedProfile();
    const b = await makeClaimedProfile();
    await db.insert(ratings).values([{ profileId: a.id, glickoRating: 1500 }, { profileId: b.id, glickoRating: 1500 }]);
    const seasonId = await makeSeason();
    const pairingId = await makeActivePairing(seasonId, a.id, b.id);

    // A daily exists this week but hasn't graded yet — no shared question has graded.
    await makeDailyInWeek('2026-07-21', { revealed: false });

    const outcome = await applyPairingMidWeekExitForProfile(db, a.id, 'blocked', AT);
    expect(outcome).toEqual({ outcome: 'cancelled', pairingId });

    const [row] = await db.select().from(nemesisPairings).where(sql`${nemesisPairings.id} = ${pairingId}`);
    expect(row!.status).toBe('cancelled');
    expect(row!.ratingAppliedAt).toBeNull();
    expect((row!.verdict as { reason: string }).reason).toBe('blocked');

    const [ratingA] = await db.select().from(ratings).where(sql`${ratings.profileId} = ${a.id}`);
    expect(ratingA!.glickoRating).toBe(1500); // untouched

    const notifRows = await db.select().from(notifications).where(sql`${notifications.kind} = 'pairing_ended_early'`);
    expect(notifRows).toHaveLength(2);
  });
});

describe('applyPairingMidWeekExit — ≥1 shared question graded → early conclusion, normal rating application (§5.7, §14.3)', () => {
  it('scores graded daily questions only, applies ratings immediately, and stamps rating_applied_at (idempotency guard)', async () => {
    const a = await makeClaimedProfile();
    const b = await makeClaimedProfile();
    await db.insert(ratings).values([{ profileId: a.id, glickoRating: 1500, glickoRd: 200 }, { profileId: b.id, glickoRating: 1500, glickoRd: 200 }]);
    const seasonId = await makeSeason();
    const pairingId = await makeActivePairing(seasonId, a.id, b.id);

    // Monday: graded, a wins, b loses (a is the leader — blocking must not erase this).
    const day1 = await makeDailyInWeek('2026-07-20', { revealed: true });
    await addPick(day1, a.id, { side: 'yes', result: 'win', edge: 0.5 });
    await addPick(day1, b.id, { side: 'no', result: 'loss', edge: -0.5 });

    // Tuesday: not yet graded (open) — excluded from scoring, not counted as "graded" either.
    await makeDailyInWeek('2026-07-21', { revealed: false });

    const pairing = (await db.select().from(nemesisPairings).where(sql`${nemesisPairings.id} = ${pairingId}`))[0]!;
    const outcome = await applyPairingMidWeekExit(db, pairing, 'suspended', AT);
    expect(outcome.outcome).toBe('completed');

    const [row] = await db.select().from(nemesisPairings).where(sql`${nemesisPairings.id} = ${pairingId}`);
    expect(row!.status).toBe('completed');
    expect(row!.scoreA).toBe(row!.profileAId === a.id ? 1 : 0);
    expect(row!.scoreB).toBe(row!.profileBId === b.id ? 0 : 1);
    expect(row!.winnerProfileId).toBe(a.id);
    expect(row!.ratingAppliedAt).not.toBeNull();
    expect((row!.verdict as { reason: string }).reason).toBe('suspended');

    const [ratingA] = await db.select().from(ratings).where(sql`${ratings.profileId} = ${a.id}`);
    const [ratingB] = await db.select().from(ratings).where(sql`${ratings.profileId} = ${b.id}`);
    expect(ratingA!.glickoRating).toBeGreaterThan(1500); // winner gains
    expect(ratingB!.glickoRating).toBeLessThan(1500); // loser drops
    expect(ratingA!.gamesCount).toBe(1);
    expect(ratingB!.gamesCount).toBe(1);
  });

  it('counts a graded nemesis_bonus question too, not just dailies (the WS11-T3 gap this task closes)', async () => {
    const a = await makeClaimedProfile();
    const b = await makeClaimedProfile();
    await db.insert(ratings).values([{ profileId: a.id }, { profileId: b.id }]);
    const seasonId = await makeSeason();
    const pairingId = await makeActivePairing(seasonId, a.id, b.id);

    // No dailies at all this week — only a graded bonus question.
    const bonusMarket = buildMarket({ status: 'resolved', outcome: 'yes' });
    await db.insert(markets).values(bonusMarket);
    const bonusQuestion = buildQuestion(bonusMarket.id as string, {
      kind: 'nemesis_bonus',
      questionDate: null,
      status: 'revealed',
      outcome: 'yes',
      settledAt: AT,
      revealedAt: AT,
    });
    await db.insert(questions).values(bonusQuestion);
    await db.insert(pairingQuestions).values({ pairingId, questionId: bonusQuestion.id as string });
    await addPick(bonusQuestion.id as string, a.id, { side: 'yes', result: 'win', edge: 0.4 });
    await addPick(bonusQuestion.id as string, b.id, { side: 'no', result: 'loss', edge: -0.4 });

    const pairing = (await db.select().from(nemesisPairings).where(sql`${nemesisPairings.id} = ${pairingId}`))[0]!;
    const outcome = await applyPairingMidWeekExit(db, pairing, 'deleted', AT);
    expect(outcome.outcome).toBe('completed'); // graded via the bonus question alone

    const [row] = await db.select().from(nemesisPairings).where(sql`${nemesisPairings.id} = ${pairingId}`);
    expect(row!.winnerProfileId).toBe(a.id);
  });
});

describe('applyPairingMidWeekExit / ForProfile — idempotency + no-active-pairing', () => {
  it('is a no-op for a pairing that is not active (already concluded)', async () => {
    const a = await makeClaimedProfile();
    const b = await makeClaimedProfile();
    const seasonId = await makeSeason();
    const pairingId = await makeActivePairing(seasonId, a.id, b.id);
    await db.update(nemesisPairings).set({ status: 'completed' }).where(sql`${nemesisPairings.id} = ${pairingId}`);

    const pairing = (await db.select().from(nemesisPairings).where(sql`${nemesisPairings.id} = ${pairingId}`))[0]!;
    const outcome = await applyPairingMidWeekExit(db, pairing, 'blocked', AT);
    expect(outcome).toEqual({ outcome: 'noop' });
  });

  it('applyPairingMidWeekExitForProfile no-ops when the profile has no active pairing', async () => {
    const a = await makeClaimedProfile();
    const outcome = await applyPairingMidWeekExitForProfile(db, a.id, 'blocked', AT);
    expect(outcome).toEqual({ outcome: 'noop' });
  });
});
