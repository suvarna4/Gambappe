/**
 * WS6-T1 integration AC (§8.5, §9.2): duo queue eligibility gates (test each rejection reason),
 * single waiting entry per profile enforced (incl. the TOCTOU race path), leave/rejoin, and
 * `GET /duo/current`'s duo+match lookup. Exercises `apps/web/lib/duo-queue.ts` directly rather
 * than the Next.js route handlers — mirrors the WS2-T3 `runClaim` integration test pattern
 * (`claim-flow.test.ts`), since route auth (Auth.js session resolution) isn't this task's
 * concern and isn't mocked anywhere else in the repo yet.
 *
 * Connects via TEST_DATABASE_URL (CI sets this to receipts_test — see .github/workflows/ci.yml
 * and every other integration test's fallback default). When developing locally alongside other
 * concurrent agents on the same machine, export TEST_DATABASE_URL to point at a dedicated DB
 * instead of changing this file's fallback — turbo.json's globalPassThroughEnv doesn't include
 * TEST_DATABASE_URL, so CI relies on this literal default matching the shared convention.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { uuidv7 } from 'uuidv7';
import type pg from 'pg';
import {
  connect,
  duoMatches,
  duoQueueEntries,
  duos,
  markets,
  picks,
  profiles,
  questions,
  users,
  type Db,
  type ProfileRow,
} from '@receipts/db';
import { buildMarket, buildPick, buildProfile, buildQuestion } from '@receipts/db/testing';
import {
  checkDuoEligibility,
  computePartnerPickToday,
  eligibilityError,
  getCurrentDuoAndMatch,
  joinDuoQueue,
  leaveDuoQueue,
} from '@/lib/duo-queue';

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
    migrationsFolder: join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'packages', 'db', 'drizzle'),
  });
});

afterAll(async () => {
  await pool.end();
});

async function makeClaimedProfile(overrides: Partial<ProfileRow> = {}): Promise<ProfileRow> {
  const userId = uuidv7();
  await db.insert(users).values({ id: userId, email: `${userId}@example.com` });
  const row = buildProfile({ kind: 'claimed', status: 'active', userId, ...overrides });
  const [inserted] = await db.insert(profiles).values(row).returning();
  return inserted!;
}

/** Inserts `count` distinct graded (win) picks for `profileId` — each on its own fresh question. */
async function makeGradedPicks(profileId: string, count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    const market = buildMarket({ status: 'resolved', outcome: 'yes' });
    await db.insert(markets).values(market);
    const question = buildQuestion(market.id as string, { status: 'revealed' });
    await db.insert(questions).values(question);
    await db.insert(picks).values(
      buildPick(question.id as string, profileId, {
        side: 'yes',
        result: 'win',
        edge: 0.4,
        gradedAt: new Date(),
      }),
    );
  }
}

describe('checkDuoEligibility (§8.5)', () => {
  it('rejects a non-active profile (not_active)', async () => {
    const profile = await makeClaimedProfile({ status: 'paused_matchmaking' });
    const result = await checkDuoEligibility(db, profile);
    expect(result).toMatchObject({ eligible: false, reason: 'not_active' });
  });

  it('rejects a profile below DUO_MIN_PICKS graded picks (insufficient_picks)', async () => {
    const profile = await makeClaimedProfile();
    await makeGradedPicks(profile.id, 3); // DUO_MIN_PICKS is 10
    const result = await checkDuoEligibility(db, profile);
    expect(result).toMatchObject({ eligible: false, reason: 'insufficient_picks', gradedPicks: 3 });
  });

  it('rejects a profile that already has an active duo (already_in_duo)', async () => {
    const profile = await makeClaimedProfile();
    await makeGradedPicks(profile.id, 10);
    const partner = await makeClaimedProfile();
    const [a, b] = profile.id < partner.id ? [profile.id, partner.id] : [partner.id, profile.id];
    await db.insert(duos).values({ id: uuidv7(), profileAId: a, profileBId: b, status: 'active' });

    const result = await checkDuoEligibility(db, profile);
    expect(result).toMatchObject({ eligible: false, reason: 'already_in_duo' });
  });

  it('rejects a profile that already has a waiting queue entry (already_queued)', async () => {
    const profile = await makeClaimedProfile();
    await makeGradedPicks(profile.id, 10);
    await db.insert(duoQueueEntries).values({ id: uuidv7(), profileId: profile.id, status: 'waiting' });

    const result = await checkDuoEligibility(db, profile);
    expect(result).toMatchObject({ eligible: false, reason: 'already_queued' });
  });

  it('is eligible once active, ≥10 graded picks, no active duo, not queued', async () => {
    const profile = await makeClaimedProfile();
    await makeGradedPicks(profile.id, 10);
    const result = await checkDuoEligibility(db, profile);
    expect(result).toEqual({ eligible: true, gradedPicks: 10 });
  });

  it('eligibilityError produces an ELIGIBILITY_NOT_MET ApiError carrying the reason', () => {
    const err = eligibilityError('insufficient_picks', 4);
    expect(err.code).toBe('ELIGIBILITY_NOT_MET');
    expect(err.status).toBe(422);
    expect(err.details).toMatchObject({ reason: 'insufficient_picks', graded_picks: 4 });
  });
});

describe('joinDuoQueue / leaveDuoQueue (§9.2 POST|DELETE /duo/queue)', () => {
  it('creates a waiting entry for an eligible profile', async () => {
    const profile = await makeClaimedProfile();
    await makeGradedPicks(profile.id, 10);

    const entry = await joinDuoQueue(db, profile);
    expect(entry.status).toBe('waiting');
    expect(entry.profileId).toBe(profile.id);
  });

  it('throws ELIGIBILITY_NOT_MET (not the raw DB error) for an ineligible profile', async () => {
    const profile = await makeClaimedProfile();
    // 0 graded picks.
    await expect(joinDuoQueue(db, profile)).rejects.toMatchObject({
      code: 'ELIGIBILITY_NOT_MET',
      details: { reason: 'insufficient_picks' },
    });
  });

  it('enforces a single waiting entry per profile — a second join is rejected', async () => {
    const profile = await makeClaimedProfile();
    await makeGradedPicks(profile.id, 10);

    await joinDuoQueue(db, profile);
    await expect(joinDuoQueue(db, profile)).rejects.toMatchObject({
      code: 'ELIGIBILITY_NOT_MET',
      details: { reason: 'already_queued' },
    });

    const rows = await db
      .select()
      .from(duoQueueEntries)
      .where(sql`${duoQueueEntries.profileId} = ${profile.id} AND ${duoQueueEntries.status} = 'waiting'`);
    expect(rows).toHaveLength(1);
  });

  it('closes the TOCTOU race: two concurrent joins for the same profile leave exactly one waiting row', async () => {
    const profile = await makeClaimedProfile();
    await makeGradedPicks(profile.id, 10);

    const results = await Promise.allSettled([joinDuoQueue(db, profile), joinDuoQueue(db, profile)]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: 'ELIGIBILITY_NOT_MET' });

    const rows = await db
      .select()
      .from(duoQueueEntries)
      .where(sql`${duoQueueEntries.profileId} = ${profile.id} AND ${duoQueueEntries.status} = 'waiting'`);
    expect(rows).toHaveLength(1);
  });

  it('leaveDuoQueue cancels the waiting row and returns true', async () => {
    const profile = await makeClaimedProfile();
    await makeGradedPicks(profile.id, 10);
    await joinDuoQueue(db, profile);

    const left = await leaveDuoQueue(db, profile.id);
    expect(left).toBe(true);

    const [row] = await db.select().from(duoQueueEntries).where(sql`${duoQueueEntries.profileId} = ${profile.id}`);
    expect(row!.status).toBe('cancelled');
  });

  it('leaveDuoQueue returns false when the profile has no waiting entry', async () => {
    const profile = await makeClaimedProfile();
    const left = await leaveDuoQueue(db, profile.id);
    expect(left).toBe(false);
  });

  it('after leaving, the profile can rejoin the queue', async () => {
    const profile = await makeClaimedProfile();
    await makeGradedPicks(profile.id, 10);
    await joinDuoQueue(db, profile);
    await leaveDuoQueue(db, profile.id);

    const entry = await joinDuoQueue(db, profile);
    expect(entry.status).toBe('waiting');
  });
});

describe('getCurrentDuoAndMatch (§9.2 GET /duo/current)', () => {
  it('returns nulls when the profile has no active duo', async () => {
    const profile = await makeClaimedProfile();
    const result = await getCurrentDuoAndMatch(db, profile.id);
    expect(result).toEqual({ duo: null, match: null });
  });

  it('returns the active duo (not a disbanded one) with a null match when none is scheduled/active', async () => {
    const profile = await makeClaimedProfile();

    // A disbanded duo from the past must not be picked up.
    const oldPartner = await makeClaimedProfile();
    const [oldA, oldB] =
      profile.id < oldPartner.id ? [profile.id, oldPartner.id] : [oldPartner.id, profile.id];
    await db.insert(duos).values({ id: uuidv7(), profileAId: oldA, profileBId: oldB, status: 'disbanded' });

    const partner = await makeClaimedProfile();
    const [a, b] = profile.id < partner.id ? [profile.id, partner.id] : [partner.id, profile.id];
    const [activeDuo] = await db
      .insert(duos)
      .values({ id: uuidv7(), profileAId: a, profileBId: b, status: 'active', tier: 2, glickoRating: 1550 })
      .returning();

    const result = await getCurrentDuoAndMatch(db, profile.id);
    expect(result.duo?.id).toBe(activeDuo!.id);
    expect(result.match).toBeNull();
  });

  it('surfaces a scheduled/active match but not a completed/cancelled one', async () => {
    const profile = await makeClaimedProfile();
    const partner = await makeClaimedProfile();
    const [a, b] = profile.id < partner.id ? [profile.id, partner.id] : [partner.id, profile.id];
    const [duo] = await db
      .insert(duos)
      .values({ id: uuidv7(), profileAId: a, profileBId: b, status: 'active' })
      .returning();

    const opponentA = await makeClaimedProfile();
    const opponentB = await makeClaimedProfile();
    const [oa, ob] = opponentA.id < opponentB.id ? [opponentA.id, opponentB.id] : [opponentB.id, opponentA.id];
    const [opponentDuo] = await db
      .insert(duos)
      .values({ id: uuidv7(), profileAId: oa, profileBId: ob, status: 'active' })
      .returning();

    // A completed match from an earlier window must not be picked up.
    await db.insert(duoMatches).values({
      id: uuidv7(),
      duoAId: duo!.id,
      duoBId: opponentDuo!.id,
      windowStart: '2026-07-07',
      windowEnd: '2026-07-09',
      status: 'completed',
    });

    const [currentMatch] = await db
      .insert(duoMatches)
      .values({
        id: uuidv7(),
        duoAId: duo!.id,
        duoBId: opponentDuo!.id,
        windowStart: '2026-07-14',
        windowEnd: '2026-07-16',
        status: 'active',
      })
      .returning();

    const result = await getCurrentDuoAndMatch(db, profile.id);
    expect(result.duo?.id).toBe(duo!.id);
    expect(result.match?.id).toBe(currentMatch!.id);
  });
});

describe('computePartnerPickToday (§9.2 GET /duo/current, SW10-T3(a) wiring-gaps doc §4)', () => {
  async function makeActiveDuo(memberAId: string, memberBId: string) {
    const [a, b] = memberAId < memberBId ? [memberAId, memberBId] : [memberBId, memberAId];
    const [duo] = await db
      .insert(duos)
      .values({ id: uuidv7(), profileAId: a, profileBId: b, status: 'active' })
      .returning();
    return duo!;
  }

  /** A real `daily` question on an auto-assigned unique date (the factory's own
   * `nextQuestionDate()`, same collision-avoidance every other fixture in this file relies on —
   * a hand-picked fixed date risks colliding with another test's auto-assigned one in this
   * shared, never-truncated file). Returns the row so the caller can read `questionDate` back
   * for the `at` instant it passes to `computePartnerPickToday`. */
  async function makeDailyQuestion() {
    const [market] = await db.insert(markets).values(buildMarket()).returning();
    const [question] = await db
      .insert(questions)
      .values(buildQuestion(market!.id as string, { status: 'open' }))
      .returning();
    return question!;
  }

  it('is {picked: false, picked_at: null} when today has no daily question yet', async () => {
    const [viewer, partner] = await Promise.all([makeClaimedProfile(), makeClaimedProfile()]);
    const duo = await makeActiveDuo(viewer.id, partner.id);

    // Far enough out that no auto-assigned `nextQuestionDate()` fixture in this file's run will
    // ever reach it (those start at 2026-01-02 and advance one day per factory call).
    const result = await computePartnerPickToday(db, duo, viewer.id, new Date('2099-01-01T18:00:00Z'));
    expect(result).toEqual({ picked: false, picked_at: null });
  });

  it("is {picked: false, picked_at: null} when today's question exists but the partner hasn't picked it", async () => {
    const [viewer, partner] = await Promise.all([makeClaimedProfile(), makeClaimedProfile()]);
    const duo = await makeActiveDuo(viewer.id, partner.id);
    const question = await makeDailyQuestion();

    const at = new Date(`${question.questionDate}T18:00:00Z`);
    const result = await computePartnerPickToday(db, duo, viewer.id, at);
    expect(result).toEqual({ picked: false, picked_at: null });
  });

  it("is picked: true with a minute-truncated picked_at once the partner has picked today's question", async () => {
    const [viewer, partner] = await Promise.all([makeClaimedProfile(), makeClaimedProfile()]);
    const duo = await makeActiveDuo(viewer.id, partner.id);
    const question = await makeDailyQuestion();
    const pickedAt = new Date(`${question.questionDate}T14:22:47.512Z`);
    await db.insert(picks).values(buildPick(question.id, partner.id, { pickedAt }));

    const at = new Date(`${question.questionDate}T18:00:00Z`);
    const result = await computePartnerPickToday(db, duo, viewer.id, at);
    expect(result.picked).toBe(true);
    expect(result.picked_at).toBe(`${question.questionDate}T14:22:00.000Z`); // seconds/ms truncated away
  });

  it('never surfaces the VIEWER picking as "partner picked" (side-free, but partner-scoped)', async () => {
    const [viewer, partner] = await Promise.all([makeClaimedProfile(), makeClaimedProfile()]);
    const duo = await makeActiveDuo(viewer.id, partner.id);
    const question = await makeDailyQuestion();
    // The VIEWER picked, not the partner.
    await db.insert(picks).values(buildPick(question.id, viewer.id, {}));

    const at = new Date(`${question.questionDate}T18:00:00Z`);
    const result = await computePartnerPickToday(db, duo, viewer.id, at);
    expect(result).toEqual({ picked: false, picked_at: null });
  });

  it('never includes a `side` key — existence + timing only (§9.3)', async () => {
    const [viewer, partner] = await Promise.all([makeClaimedProfile(), makeClaimedProfile()]);
    const duo = await makeActiveDuo(viewer.id, partner.id);
    const question = await makeDailyQuestion();
    await db.insert(picks).values(buildPick(question.id, partner.id, { side: 'no' }));

    const at = new Date(`${question.questionDate}T18:00:00Z`);
    const result = await computePartnerPickToday(db, duo, viewer.id, at);
    expect(Object.keys(result).sort()).toEqual(['picked', 'picked_at']);
  });

  it('resolves the partner correctly regardless of which side of the duo the viewer is stored on', async () => {
    const [viewer, partner] = await Promise.all([makeClaimedProfile(), makeClaimedProfile()]);
    const duo = await makeActiveDuo(viewer.id, partner.id);
    // Confirm the canonical a<b ordering doesn't dictate which member is "the viewer" here —
    // exercise it from whichever side the viewer landed on.
    const viewerIsA = duo.profileAId === viewer.id;
    expect(viewerIsA || duo.profileBId === viewer.id).toBe(true);

    const question = await makeDailyQuestion();
    await db.insert(picks).values(buildPick(question.id, partner.id, {}));

    const at = new Date(`${question.questionDate}T18:00:00Z`);
    const result = await computePartnerPickToday(db, duo, viewer.id, at);
    expect(result.picked).toBe(true);
  });
});
