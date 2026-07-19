/**
 * WS5-T4 integration (§9.2 `GET /pairings/current`, `GET /pairings/:id`,
 * `GET /me/nemesis-history`; §9.3 masking rules) against a real Postgres — exercises
 * `apps/web/lib/nemesis/service.ts` directly rather than the Next.js route handlers, mirroring
 * `duo-public-api.test.ts`'s own header note: route auth (Auth.js session resolution) isn't
 * mocked anywhere in this repo yet, so every mode-lifecycle integration test exercises `lib/`
 * functions directly. Each route's own wiring is a thin parse-then-delegate layer with no
 * extra logic of its own (see the route files themselves).
 *
 * Connects via TEST_DATABASE_URL (CI sets this to receipts_test — see every other integration
 * test's fallback default).
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
  picks,
  profiles,
  questions,
  ratings,
  seasons,
  type Db,
  type ProfileRow,
} from '@receipts/db';
import { buildMarket, buildNemesisPairing, buildPick, buildProfile, buildQuestion, buildRating, buildSeason } from '@receipts/db/testing';
import {
  getCurrentPairingForProfile,
  getNemesisHistoryPage,
  getPairingPublicById,
  getPairingSideRef,
} from '@/lib/nemesis/service';

const dbUrl = process.env.TEST_DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts_test';

const NOW = new Date('2026-07-19T18:00:00Z'); // a Sunday, mid nemesis week
const WEEK_START = '2026-07-13'; // the Monday of NOW's ISO week

let pool: pg.Pool;
let db: Db;

beforeAll(async () => {
  ({ pool, db } = connect({ connectionString: dbUrl }));
  await db.execute(sql`DROP SCHEMA public CASCADE`);
  await db.execute(sql`CREATE SCHEMA public`);
  await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  await migrate(db, {
    migrationsFolder: join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'packages', 'db', 'drizzle'),
  });
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE TABLE pairing_questions, nemesis_pairings, ratings, picks, questions, markets, profiles, seasons RESTART IDENTITY CASCADE`,
  );
});

async function makeClaimedProfile(overrides: Partial<ProfileRow> = {}): Promise<ProfileRow> {
  const [row] = await db.insert(profiles).values(buildProfile({ kind: 'claimed', status: 'active', ...overrides })).returning();
  return row!;
}

async function makeSeasonRow(): Promise<string> {
  const [row] = await db.insert(seasons).values(buildSeason({ startsOn: '2026-07-06', endsOn: '2026-09-28' })).returning();
  return row!.id;
}

async function makePairing(
  seasonId: string,
  profileAId: string,
  profileBId: string,
  overrides: Partial<typeof nemesisPairings.$inferInsert> = {},
): Promise<string> {
  const [inserted] = await db
    .insert(nemesisPairings)
    .values(buildNemesisPairing(seasonId, profileAId, profileBId, { weekStart: WEEK_START, ...overrides }))
    .returning();
  return inserted!.id;
}

/** A `daily` question anchored inside `WEEK_START..WEEK_START+6`, with a real market row. */
async function makeDailyQuestion(
  dayOffset: number,
  overrides: Partial<typeof questions.$inferInsert> = {},
): Promise<string> {
  const [market] = await db.insert(markets).values(buildMarket({ status: 'resolved', outcome: 'yes' })).returning();
  const questionDate = new Date(`${WEEK_START}T00:00:00Z`);
  questionDate.setUTCDate(questionDate.getUTCDate() + dayOffset);
  const dateStr = questionDate.toISOString().slice(0, 10);
  const [inserted] = await db
    .insert(questions)
    .values(
      buildQuestion(market!.id as string, {
        kind: 'daily',
        questionDate: dateStr,
        slug: `${dateStr}-nemesis-test-${uuidv7()}`,
        status: 'revealed',
        outcome: 'yes',
        ...overrides,
      }),
    )
    .returning();
  return inserted!.id;
}

async function makePick(
  questionId: string,
  profileId: string,
  overrides: Partial<typeof picks.$inferInsert> = {},
): Promise<void> {
  await db.insert(picks).values(buildPick(questionId, profileId, overrides));
}

async function makeRating(profileId: string, overrides: Partial<typeof ratings.$inferInsert> = {}): Promise<void> {
  await db.insert(ratings).values(buildRating(profileId, overrides));
}

describe('getPairingPublicById (§9.2 GET /pairings/:id, §9.3 masking)', () => {
  it('returns null for an unknown pairing id', async () => {
    await expect(getPairingPublicById(db, uuidv7(), NOW)).resolves.toBeNull();
  });

  it('masks BOTH sides pre-lock, unmasks post-lock, and holds result at "pending" until revealed', async () => {
    const seasonId = await makeSeasonRow();
    const [a, b] = await Promise.all([makeClaimedProfile(), makeClaimedProfile()]);
    const pairingId = await makePairing(seasonId, a.id, b.id, { status: 'active', scoreA: 1, scoreB: 0 });

    // Day 0: locked AND revealed — fully visible, real result.
    const revealedQ = await makeDailyQuestion(0, { lockAt: new Date(NOW.getTime() - 3600_000), status: 'revealed' });
    await makePick(revealedQ, a.id, { side: 'yes', result: 'win', edge: 0.4 });
    await makePick(revealedQ, b.id, { side: 'no', result: 'loss', edge: -0.6 });

    // Day 1: locked but NOT yet revealed — side visible, result must read "pending" (§6.5).
    const lockedQ = await makeDailyQuestion(1, { lockAt: new Date(NOW.getTime() - 3600_000), status: 'locked' });
    await makePick(lockedQ, a.id, { side: 'yes', result: 'win', edge: 0.4 }); // internally graded already
    await makePick(lockedQ, b.id, { side: 'no', result: 'loss', edge: -0.6 });

    // Day 2: still open (not locked) — BOTH sides fully masked, even though picks exist (§9.3:
    // "nothing about whether someone has picked leaks pre-lock either").
    const openQ = await makeDailyQuestion(2, { lockAt: new Date(NOW.getTime() + 3600_000), status: 'open' });
    await makePick(openQ, a.id, { side: 'yes', result: 'pending' });
    await makePick(openQ, b.id, { side: 'no', result: 'pending' });

    const pairing = await getPairingPublicById(db, pairingId, NOW);
    expect(pairing).not.toBeNull();
    expect(pairing!.id).toBe(pairingId);
    expect(pairing!.a.profile_id).toBe(a.id);
    expect(pairing!.b.profile_id).toBe(b.id);
    expect(pairing!.score).toEqual({ a: 1, b: 0 });
    expect(pairing!.narrative_line).toBeNull(); // SPEC-GAP(ws5-t4) — see service.ts header

    const rows = pairing!.scoreboard;
    expect(rows).toHaveLength(3);

    const byQuestion = new Map(rows.map((r) => [r.question_id as string, r]));
    const revealedRow = byQuestion.get(revealedQ)!;
    expect(revealedRow.a).toEqual({ side: 'yes', result: 'win' });
    expect(revealedRow.b).toEqual({ side: 'no', result: 'loss' });

    const lockedRow = byQuestion.get(lockedQ)!;
    expect(lockedRow.a).toEqual({ side: 'yes', result: 'pending' });
    expect(lockedRow.b).toEqual({ side: 'no', result: 'pending' });

    const openRow = byQuestion.get(openQ)!;
    expect(openRow.a).toBeNull();
    expect(openRow.b).toBeNull();
  });

  it('includes a nemesis_bonus question shared via pairing_questions even outside the daily-date window', async () => {
    const seasonId = await makeSeasonRow();
    const [a, b] = await Promise.all([makeClaimedProfile(), makeClaimedProfile()]);
    const pairingId = await makePairing(seasonId, a.id, b.id, { status: 'active' });

    const [market] = await db.insert(markets).values(buildMarket({ status: 'resolved', outcome: 'yes' })).returning();
    const [bonusQ] = await db
      .insert(questions)
      .values(
        buildQuestion(market!.id as string, {
          kind: 'nemesis_bonus',
          questionDate: null,
          slug: `nemesis-bonus-${uuidv7()}`,
          lockAt: new Date(NOW.getTime() - 3600_000),
          status: 'revealed',
          outcome: 'yes',
        }),
      )
      .returning();
    await db.execute(sql`INSERT INTO pairing_questions (pairing_id, question_id) VALUES (${pairingId}, ${bonusQ!.id})`);
    await makePick(bonusQ!.id as string, a.id, { side: 'yes', result: 'win', edge: 0.3 });

    const pairing = await getPairingPublicById(db, pairingId, NOW);
    const bonusRow = pairing!.scoreboard.find((r) => r.question_id === bonusQ!.id);
    expect(bonusRow).toBeDefined();
    expect(bonusRow!.kind).toBe('nemesis_bonus');
    expect(bonusRow!.a).toEqual({ side: 'yes', result: 'win' });
    expect(bonusRow!.b).toBeNull(); // no pick from b
  });
});

describe('getCurrentPairingForProfile (§9.2 GET /pairings/current)', () => {
  it("returns the profile's active pairing from either side", async () => {
    const seasonId = await makeSeasonRow();
    const [a, b] = await Promise.all([makeClaimedProfile(), makeClaimedProfile()]);
    const pairingId = await makePairing(seasonId, a.id, b.id, { status: 'active' });

    const fromA = await getCurrentPairingForProfile(db, a.id, NOW);
    const fromB = await getCurrentPairingForProfile(db, b.id, NOW);
    expect(fromA?.id).toBe(pairingId);
    expect(fromB?.id).toBe(pairingId);
  });

  it('returns null when the profile has no active pairing', async () => {
    const someone = await makeClaimedProfile();
    await expect(getCurrentPairingForProfile(db, someone.id, NOW)).resolves.toBeNull();
  });

  it('ignores a completed pairing (only `active` counts as current)', async () => {
    const seasonId = await makeSeasonRow();
    const [a, b] = await Promise.all([makeClaimedProfile(), makeClaimedProfile()]);
    await makePairing(seasonId, a.id, b.id, { status: 'completed' });

    await expect(getCurrentPairingForProfile(db, a.id, NOW)).resolves.toBeNull();
  });
});

describe('getNemesisHistoryPage (§9.2 GET /me/nemesis-history)', () => {
  it('lists completed + cancelled pairings, newest week first, with outcome relative to the viewer', async () => {
    const seasonId = await makeSeasonRow();
    const [viewer, winOpp, lossOpp, drawOpp, cancelOpp] = await Promise.all([
      makeClaimedProfile(),
      makeClaimedProfile(),
      makeClaimedProfile(),
      makeClaimedProfile(),
      makeClaimedProfile(),
    ]);

    await makePairing(seasonId, viewer.id, winOpp.id, {
      weekStart: '2026-06-01',
      status: 'completed',
      scoreA: 3,
      scoreB: 1,
      winnerProfileId: viewer.id,
    });
    await makePairing(seasonId, lossOpp.id, viewer.id, {
      weekStart: '2026-06-08',
      status: 'completed',
      scoreA: 3,
      scoreB: 1,
      winnerProfileId: lossOpp.id, // profileA (lossOpp) won -> viewer (profileB) lost
    });
    await makePairing(seasonId, viewer.id, drawOpp.id, {
      weekStart: '2026-06-15',
      status: 'completed',
      scoreA: 2,
      scoreB: 2,
      winnerProfileId: null,
    });
    await makePairing(seasonId, viewer.id, cancelOpp.id, {
      weekStart: '2026-06-22',
      status: 'cancelled',
      scoreA: 0,
      scoreB: 0,
      winnerProfileId: null,
    });
    // An `active` pairing must NOT appear in history at all.
    await makePairing(seasonId, viewer.id, winOpp.id, { weekStart: '2026-06-29', status: 'active' });

    const page = await getNemesisHistoryPage(db, viewer.id, {});
    expect(page.data).toHaveLength(4);
    // Newest week first.
    expect(page.data.map((e) => e.week_start)).toEqual(['2026-06-22', '2026-06-15', '2026-06-08', '2026-06-01']);
    expect(page.data.map((e) => e.outcome)).toEqual(['cancelled', 'draw', 'loss', 'win']);
    expect(page.data[3]!.opponent.profile_id).toBe(winOpp.id);
    expect(page.data[3]!.my_score).toBe(3);
    expect(page.data[3]!.their_score).toBe(1);
    expect(page.meta.next_cursor).toBeNull();
  });

  it('paginates with a next_cursor, and the second page picks up where the first left off', async () => {
    const seasonId = await makeSeasonRow();
    const viewer = await makeClaimedProfile();
    const opponents = await Promise.all([makeClaimedProfile(), makeClaimedProfile(), makeClaimedProfile()]);
    const weeks = ['2026-06-01', '2026-06-08', '2026-06-15'];
    for (let i = 0; i < 3; i++) {
      await makePairing(seasonId, viewer.id, opponents[i]!.id, { weekStart: weeks[i], status: 'completed' });
    }

    const first = await getNemesisHistoryPage(db, viewer.id, { limit: 2 });
    expect(first.data).toHaveLength(2);
    expect(first.meta.next_cursor).not.toBeNull();

    const second = await getNemesisHistoryPage(db, viewer.id, { limit: 2, cursor: first.meta.next_cursor! });
    expect(second.data).toHaveLength(1);
    expect(second.meta.next_cursor).toBeNull();

    const seenPairingIds = [...first.data, ...second.data].map((e) => e.pairing_id);
    expect(new Set(seenPairingIds).size).toBe(3);
  });

  it('returns an empty page for a profile with no pairing history', async () => {
    const someone = await makeClaimedProfile();
    const page = await getNemesisHistoryPage(db, someone.id, {});
    expect(page.data).toEqual([]);
    expect(page.meta.next_cursor).toBeNull();
  });
});

describe('getPairingSideRef (§9.2 GET /profiles/:slug rating subset)', () => {
  it('returns rating info for a known slug', async () => {
    const profile = await makeClaimedProfile();
    await makeRating(profile.id, { glickoRating: 1620, glickoRd: 80, gamesCount: 12, accuracyPercentile: 77 });

    const ref = await getPairingSideRef(db, profile.slug);
    expect(ref?.handle).toBe(profile.handle);
    expect(ref?.rating).toEqual({
      glicko_rating: 1620,
      glicko_rd: 80,
      games_count: 12,
      accuracy_percentile: 77,
    });
  });

  it('returns rating: null when the profile has no ratings row yet', async () => {
    const profile = await makeClaimedProfile();
    const ref = await getPairingSideRef(db, profile.slug);
    expect(ref?.rating).toBeNull();
  });

  it('returns null for an unknown slug', async () => {
    await expect(getPairingSideRef(db, 'nobody-0000')).resolves.toBeNull();
  });
});
