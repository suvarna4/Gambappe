/**
 * WS5-T3 integration AC (§8.8, §19.3): `nemesis:conclude` against a real Postgres.
 *
 *   - tie→edge→draw cascade (score tie broken by edge; edge tie within EDGE_DRAW_EPSILON → draw).
 *   - unsettled/void question exclusion recorded in `verdict.excludedQuestionIds`.
 *   - `rating_applied_at` stays NULL (left for `ratings:weekly` an hour later, §6.5).
 *   - idempotent: a concurrent/duplicate run only concludes each pairing once.
 *   - `nemesis` flag gating.
 *   - win/loss/draw beats land in the outbox for both participants.
 *
 * Connects via TEST_DATABASE_URL, same convention as `pairing-lifecycle.test.ts` and
 * `nemesis-assign.test.ts`.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type pg from 'pg';
import {
  connect,
  markets,
  nemesisPairings,
  notifications,
  picks,
  profiles,
  questions,
  seasons,
  type Db,
  type ProfileRow,
} from '@receipts/db';
import { buildMarket, buildNemesisPairing, buildProfile, buildPick, buildQuestion, buildSeason } from '@receipts/db/testing';
import { nemesisConcludeHandler, runNemesisConclude } from '../../src/jobs/nemesis-conclude.js';
import type { JobContext } from '../../src/context.js';

const dbUrl = process.env.TEST_DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts_test';

const WEEK_START = '2026-07-13'; // a Monday
const AT = new Date('2026-07-20T02:00:00Z'); // Sun 22:00 ET (EDT, UTC-4)

let pool: pg.Pool;
let db: Db;

beforeAll(async () => {
  process.env.FLAG_NEMESIS = 'true';
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

// --- Fixtures --------------------------------------------------------------------------------

async function makeClaimedProfile(overrides: Partial<ProfileRow> = {}): Promise<ProfileRow> {
  const row = buildProfile({ kind: 'claimed', status: 'active', ...overrides });
  const [inserted] = await db.insert(profiles).values(row).returning();
  return inserted!;
}

async function makeSeason(): Promise<string> {
  const row = buildSeason({ startsOn: WEEK_START, endsOn: '2026-10-04' });
  await db.insert(seasons).values(row);
  return row.id as string;
}

async function makeActivePairing(seasonId: string, aId: string, bId: string): Promise<string> {
  const [profileAId, profileBId] = aId < bId ? [aId, bId] : [bId, aId];
  const row = buildNemesisPairing(seasonId, profileAId, profileBId, {
    weekStart: WEEK_START,
    status: 'active',
    scoreA: 0,
    scoreB: 0,
    edgeA: 0,
    edgeB: 0,
    winnerProfileId: null,
    verdict: null,
    ratingAppliedAt: null,
  });
  await db.insert(nemesisPairings).values(row);
  return row.id as string;
}

/** A daily question within the pairing's week. `status` drives isSettled/isVoid per
 * `getFullPairingSharedQuestionPicks` (revealed → settled; voided → void+settled; anything
 * else, e.g. `open`, → unsettled). */
async function makeDailyInWeek(questionDate: string, status: 'revealed' | 'open' | 'voided'): Promise<string> {
  const market = buildMarket({ status: status === 'revealed' ? 'resolved' : 'open', outcome: status === 'revealed' ? 'yes' : undefined });
  await db.insert(markets).values(market);
  const question = buildQuestion(market.id as string, {
    questionDate,
    status,
    outcome: status === 'revealed' ? 'yes' : null,
    settledAt: status === 'revealed' || status === 'voided' ? AT : null,
    revealedAt: status === 'revealed' ? AT : null,
  });
  await db.insert(questions).values(question);
  return question.id as string;
}

async function addPick(questionId: string, profileId: string, opts: { side: 'yes' | 'no'; result: 'win' | 'loss'; edge: number }): Promise<void> {
  await db.insert(picks).values(
    buildPick(questionId, profileId, { side: opts.side, result: opts.result, edge: opts.edge, gradedAt: AT }),
  );
}

async function getPairingRow(pairingId: string) {
  const [row] = await db.select().from(nemesisPairings).where(sql`${nemesisPairings.id} = ${pairingId}`);
  return row!;
}

async function getNotificationsFor(profileId: string) {
  return db.select().from(notifications).where(sql`${notifications.profileId} = ${profileId}`);
}

describe('nemesis:conclude — win/loss cascade (§8.8)', () => {
  it('scores shared dailies, sets winnerProfileId + status=completed, and leaves ratingAppliedAt null', async () => {
    const a = await makeClaimedProfile();
    const b = await makeClaimedProfile();
    const seasonId = await makeSeason();
    const pairingId = await makeActivePairing(seasonId, a.id, b.id);

    const day1 = await makeDailyInWeek('2026-07-13', 'revealed');
    await addPick(day1, a.id, { side: 'yes', result: 'win', edge: 0.5 });
    await addPick(day1, b.id, { side: 'no', result: 'loss', edge: -0.5 });

    const day2 = await makeDailyInWeek('2026-07-14', 'revealed');
    await addPick(day2, a.id, { side: 'yes', result: 'win', edge: 0.3 });
    await addPick(day2, b.id, { side: 'no', result: 'loss', edge: -0.3 });

    const day3 = await makeDailyInWeek('2026-07-15', 'revealed');
    await addPick(day3, a.id, { side: 'no', result: 'loss', edge: -0.2 });
    await addPick(day3, b.id, { side: 'yes', result: 'win', edge: 0.2 });

    const report = await runNemesisConclude(db, AT);
    expect(report).toEqual({ activePairings: 1, concluded: 1, skippedNotActive: 0, beatsWritten: 2 });

    const row = await getPairingRow(pairingId);
    expect(row.status).toBe('completed');
    expect(row.scoreA).toBe(2);
    expect(row.scoreB).toBe(1);
    expect(row.winnerProfileId).toBe(a.id);
    expect(row.ratingAppliedAt).toBeNull();
    const verdict = row.verdict as { winner: string; scoreA: number; scoreB: number; excludedQuestionIds: string[] };
    expect(verdict.winner).toBe('a');
    expect(verdict.excludedQuestionIds).toEqual([]);
  });
});

describe('nemesis:conclude — tie on score, resolved by edge (§8.8)', () => {
  it('picks the higher-edge side as winner, not a draw', async () => {
    const a = await makeClaimedProfile();
    const b = await makeClaimedProfile();
    const seasonId = await makeSeason();
    const pairingId = await makeActivePairing(seasonId, a.id, b.id);

    const day1 = await makeDailyInWeek('2026-07-13', 'revealed');
    await addPick(day1, a.id, { side: 'yes', result: 'win', edge: 0.6 });
    await addPick(day1, b.id, { side: 'no', result: 'loss', edge: -0.6 });

    const day2 = await makeDailyInWeek('2026-07-14', 'revealed');
    await addPick(day2, a.id, { side: 'no', result: 'loss', edge: -0.1 });
    await addPick(day2, b.id, { side: 'yes', result: 'win', edge: 0.1 });

    await runNemesisConclude(db, AT);

    const row = await getPairingRow(pairingId);
    expect(row.scoreA).toBe(1);
    expect(row.scoreB).toBe(1);
    expect(row.winnerProfileId).toBe(a.id); // edgeA=0.5 > edgeB=-0.5
    const verdict = row.verdict as { winner: string };
    expect(verdict.winner).toBe('a');
  });
});

describe('nemesis:conclude — true draw (§8.8)', () => {
  it('tied score AND |Δedge| < 1e-4 → winnerProfileId null, verdict.winner=draw', async () => {
    const a = await makeClaimedProfile();
    const b = await makeClaimedProfile();
    const seasonId = await makeSeason();
    const pairingId = await makeActivePairing(seasonId, a.id, b.id);

    const day1 = await makeDailyInWeek('2026-07-13', 'revealed');
    await addPick(day1, a.id, { side: 'yes', result: 'win', edge: 0.5 });
    await addPick(day1, b.id, { side: 'no', result: 'loss', edge: -0.5 });

    const day2 = await makeDailyInWeek('2026-07-14', 'revealed');
    await addPick(day2, a.id, { side: 'no', result: 'loss', edge: -0.5 });
    await addPick(day2, b.id, { side: 'yes', result: 'win', edge: 0.5 });

    await runNemesisConclude(db, AT);

    const row = await getPairingRow(pairingId);
    expect(row.scoreA).toBe(1);
    expect(row.scoreB).toBe(1);
    expect(row.winnerProfileId).toBeNull();
    const verdict = row.verdict as { winner: string };
    expect(verdict.winner).toBe('draw');

    const notifsA = await getNotificationsFor(a.id);
    const notifsB = await getNotificationsFor(b.id);
    expect(notifsA.map((n) => n.kind)).toEqual(['nemesis_verdict_draw']);
    expect(notifsB.map((n) => n.kind)).toEqual(['nemesis_verdict_draw']);
  });
});

describe('nemesis:conclude — unsettled question exclusion (§8.8)', () => {
  it('excludes a still-open shared daily from scoring and records its id', async () => {
    const a = await makeClaimedProfile();
    const b = await makeClaimedProfile();
    const seasonId = await makeSeason();
    const pairingId = await makeActivePairing(seasonId, a.id, b.id);

    const day1 = await makeDailyInWeek('2026-07-13', 'revealed');
    await addPick(day1, a.id, { side: 'yes', result: 'win', edge: 0.5 });
    await addPick(day1, b.id, { side: 'no', result: 'loss', edge: -0.5 });

    const day2 = await makeDailyInWeek('2026-07-14', 'open'); // never revealed/graded

    await runNemesisConclude(db, AT);

    const row = await getPairingRow(pairingId);
    expect(row.scoreA).toBe(1);
    expect(row.scoreB).toBe(0);
    expect(row.winnerProfileId).toBe(a.id);
    const verdict = row.verdict as { excludedQuestionIds: string[] };
    expect(verdict.excludedQuestionIds).toEqual([day2]);
  });
});

describe('nemesis:conclude — void question exclusion (§8.8)', () => {
  it('excludes a voided shared daily from scoring and records its id', async () => {
    const a = await makeClaimedProfile();
    const b = await makeClaimedProfile();
    const seasonId = await makeSeason();
    const pairingId = await makeActivePairing(seasonId, a.id, b.id);

    const day1 = await makeDailyInWeek('2026-07-13', 'revealed');
    await addPick(day1, a.id, { side: 'yes', result: 'win', edge: 0.5 });
    await addPick(day1, b.id, { side: 'no', result: 'loss', edge: -0.5 });

    const day2 = await makeDailyInWeek('2026-07-14', 'voided');

    await runNemesisConclude(db, AT);

    const row = await getPairingRow(pairingId);
    expect(row.scoreA).toBe(1);
    expect(row.scoreB).toBe(0);
    const verdict = row.verdict as { excludedQuestionIds: string[] };
    expect(verdict.excludedQuestionIds).toEqual([day2]);
  });
});

describe('nemesis:conclude — idempotency', () => {
  it('running the job twice only concludes each pairing once', async () => {
    const a = await makeClaimedProfile();
    const b = await makeClaimedProfile();
    const seasonId = await makeSeason();
    const pairingId = await makeActivePairing(seasonId, a.id, b.id);

    const day1 = await makeDailyInWeek('2026-07-13', 'revealed');
    await addPick(day1, a.id, { side: 'yes', result: 'win', edge: 0.5 });
    await addPick(day1, b.id, { side: 'no', result: 'loss', edge: -0.5 });

    const first = await runNemesisConclude(db, AT);
    expect(first.concluded).toBe(1);

    const second = await runNemesisConclude(db, AT);
    expect(second).toEqual({ activePairings: 0, concluded: 0, skippedNotActive: 0, beatsWritten: 0 });

    const row = await getPairingRow(pairingId);
    expect(row.status).toBe('completed');
    expect(row.scoreA).toBe(1); // unchanged by the second run

    const allNotifs = await db.select().from(notifications);
    expect(allNotifs).toHaveLength(2); // not duplicated
  });
});

describe('nemesis:conclude — flag gating', () => {
  it('is a no-op when the nemesis flag is disabled', async () => {
    process.env.FLAG_NEMESIS = 'false';
    try {
      const a = await makeClaimedProfile();
      const b = await makeClaimedProfile();
      const seasonId = await makeSeason();
      const pairingId = await makeActivePairing(seasonId, a.id, b.id);

      const ctx: JobContext = { db, pool, boss: undefined as unknown as JobContext['boss'], redis: undefined as unknown as JobContext['redis'] };
      await nemesisConcludeHandler(ctx, undefined);

      const row = await getPairingRow(pairingId);
      expect(row.status).toBe('active');
      const allNotifs = await db.select().from(notifications);
      expect(allNotifs).toHaveLength(0);
    } finally {
      process.env.FLAG_NEMESIS = 'true';
    }
  });
});

describe('nemesis:conclude — beats written (§13.3)', () => {
  it('writes exactly one nemesis_verdict_win/_loss row per side to the outbox', async () => {
    const a = await makeClaimedProfile();
    const b = await makeClaimedProfile();
    const seasonId = await makeSeason();
    const pairingId = await makeActivePairing(seasonId, a.id, b.id);

    const day1 = await makeDailyInWeek('2026-07-13', 'revealed');
    await addPick(day1, a.id, { side: 'yes', result: 'win', edge: 0.5 });
    await addPick(day1, b.id, { side: 'no', result: 'loss', edge: -0.5 });

    await runNemesisConclude(db, AT);

    const notifsA = await getNotificationsFor(a.id);
    const notifsB = await getNotificationsFor(b.id);
    expect(notifsA).toHaveLength(1);
    expect(notifsB).toHaveLength(1);
    expect(notifsA[0]!.kind).toBe('nemesis_verdict_win');
    expect(notifsA[0]!.channel).toBe('email');
    expect(notifsA[0]!.dedupeKey).toBe(`nemesis_verdict:${pairingId}:${a.id}`);
    expect(notifsB[0]!.kind).toBe('nemesis_verdict_loss');
    expect(notifsB[0]!.dedupeKey).toBe(`nemesis_verdict:${pairingId}:${b.id}`);
  });
});
