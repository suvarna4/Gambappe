/**
 * WS11-T3 integration: `submitReport` (auto-pause) and `applyBlock` (pairing mid-week exit)
 * against real Postgres (§14.3, §5.7). Requires a live Postgres (docker-compose / CI service).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { uuidv7 } from 'uuidv7';
import type pg from 'pg';
import {
  connect,
  getProfileById,
  insertMarket,
  insertQuestion,
  nemesisPairings,
  notifications,
  pairingQuestions,
  picks,
  profiles,
  ratings,
  seasons,
  users,
  type Db,
} from '@receipts/db';
import { buildMarket, buildProfile, buildQuestion } from '@receipts/db/testing';
import { applyBlock, submitReport } from '@/lib/moderation';

const url =
  process.env.TEST_DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts_test';

const NOW = new Date('2026-07-20T12:00:00Z');
const OLD_ENOUGH = new Date('2026-07-01T00:00:00Z'); // 19 days before NOW, well past the 7-day min
const TOO_NEW = new Date('2026-07-19T00:00:00Z'); // 1 day before NOW

let pool: pg.Pool;
let db: Db;

beforeAll(async () => {
  ({ pool, db } = connect({ connectionString: url }));
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
    sql`TRUNCATE reports, blocks, notifications, nemesis_pairings, pairing_questions, ratings, picks, questions, markets, profiles, users, seasons RESTART IDENTITY CASCADE`,
  );
});

async function makeClaimedProfile(opts: { createdAt?: Date; botScore?: number } = {}) {
  const userId = uuidv7();
  await db.insert(users).values({ id: userId, email: `${userId}@example.com`, createdAt: opts.createdAt ?? OLD_ENOUGH });
  const profile = buildProfile({ kind: 'claimed', userId, botScore: opts.botScore ?? 0 });
  await db.insert(profiles).values(profile);
  return { userId, profileId: profile.id as string };
}

async function makeGhostProfile() {
  const profile = buildProfile({ kind: 'ghost' });
  await db.insert(profiles).values(profile);
  return { profileId: profile.id as string };
}

describe('submitReport / auto-pause (§14.3)', () => {
  it('does not pause below the 3-qualified-reporter threshold', async () => {
    const reported = await makeClaimedProfile();
    const r1 = await makeClaimedProfile();
    const r2 = await makeClaimedProfile();

    await submitReport(db, { reporterProfileId: r1.profileId, reportedProfileId: reported.profileId, contextKind: 'profile', contextId: reported.profileId, reason: 'abuse' }, NOW);
    const { autoPaused } = await submitReport(db, { reporterProfileId: r2.profileId, reportedProfileId: reported.profileId, contextKind: 'profile', contextId: reported.profileId, reason: 'abuse' }, NOW);

    expect(autoPaused).toBe(false);
    const profile = await getProfileById(db, reported.profileId);
    expect(profile?.status).toBe('active');
  });

  it('pauses matchmaking on the 3rd distinct qualified reporter', async () => {
    const reported = await makeClaimedProfile();
    const reporters = [await makeClaimedProfile(), await makeClaimedProfile(), await makeClaimedProfile()];

    let lastResult;
    for (const r of reporters) {
      lastResult = await submitReport(
        db,
        { reporterProfileId: r.profileId, reportedProfileId: reported.profileId, contextKind: 'profile', contextId: reported.profileId, reason: 'abuse' },
        NOW,
      );
    }

    expect(lastResult!.autoPaused).toBe(true);
    const profile = await getProfileById(db, reported.profileId);
    expect(profile?.status).toBe('paused_matchmaking');
  });

  it('never counts a ghost reporter toward auto-pause (report-bombing guard)', async () => {
    const reported = await makeClaimedProfile();
    const ghosts = [await makeGhostProfile(), await makeGhostProfile(), await makeGhostProfile()];

    let lastResult;
    for (const g of ghosts) {
      lastResult = await submitReport(
        db,
        { reporterProfileId: g.profileId, reportedProfileId: reported.profileId, contextKind: 'profile', contextId: reported.profileId, reason: 'abuse' },
        NOW,
      );
    }

    expect(lastResult!.autoPaused).toBe(false);
    const profile = await getProfileById(db, reported.profileId);
    expect(profile?.status).toBe('active');
  });

  it('does not count a reporter whose account is younger than REPORTER_MIN_ACCOUNT_AGE_D', async () => {
    const reported = await makeClaimedProfile();
    const tooNew = [
      await makeClaimedProfile({ createdAt: TOO_NEW }),
      await makeClaimedProfile({ createdAt: TOO_NEW }),
      await makeClaimedProfile({ createdAt: TOO_NEW }),
    ];

    let lastResult;
    for (const r of tooNew) {
      lastResult = await submitReport(
        db,
        { reporterProfileId: r.profileId, reportedProfileId: reported.profileId, contextKind: 'profile', contextId: reported.profileId, reason: 'abuse' },
        NOW,
      );
    }

    expect(lastResult!.autoPaused).toBe(false);
  });

  it('does not count a bot-flagged reporter', async () => {
    const reported = await makeClaimedProfile();
    const bots = [
      await makeClaimedProfile({ botScore: 0.9 }),
      await makeClaimedProfile({ botScore: 0.9 }),
      await makeClaimedProfile({ botScore: 0.9 }),
    ];

    let lastResult;
    for (const r of bots) {
      lastResult = await submitReport(
        db,
        { reporterProfileId: r.profileId, reportedProfileId: reported.profileId, contextKind: 'profile', contextId: reported.profileId, reason: 'abuse' },
        NOW,
      );
    }

    expect(lastResult!.autoPaused).toBe(false);
  });
});

describe('applyBlock / pairing mid-week exit (§5.7, §14.3)', () => {
  async function makeActivePairing() {
    const a = await makeClaimedProfile();
    const b = await makeClaimedProfile();
    const seasonId = uuidv7();
    await db.insert(seasons).values({ id: seasonId, kind: 'nemesis', startsOn: '2026-07-20', endsOn: '2026-12-31', name: 'Test season' });
    const pairingId = uuidv7();
    await db.insert(nemesisPairings).values({
      id: pairingId,
      seasonId,
      weekStart: '2026-07-20',
      profileAId: a.profileId,
      profileBId: b.profileId,
      status: 'active',
    });
    await db.insert(ratings).values([{ profileId: a.profileId }, { profileId: b.profileId }]);
    return { a, b, pairingId };
  }

  it('cancels the pairing with no rating change when no shared question has graded', async () => {
    const { a, b, pairingId } = await makeActivePairing();

    await applyBlock(db, a.profileId, b.profileId, NOW);

    const [pairing] = await db.select().from(nemesisPairings).where(eq(nemesisPairings.id, pairingId));
    expect(pairing?.status).toBe('cancelled');
    expect(pairing?.winnerProfileId).toBeNull();

    const [ratingA] = await db.select().from(ratings).where(eq(ratings.profileId, a.profileId));
    expect(ratingA?.glickoRating).toBe(1500); // unchanged default

    const notifs = await db.select().from(notifications);
    const profileIds = notifs.map((n) => n.profileId).sort();
    expect(profileIds).toEqual([a.profileId, b.profileId].sort());
    expect(notifs.every((n) => n.kind === 'pairing_ended_early')).toBe(true);
  });

  it('early-concludes with real scoring + rating changes when a shared question has graded', async () => {
    const { a, b, pairingId } = await makeActivePairing();

    const market = await insertMarket(db, buildMarket());
    const question = await insertQuestion(
      db,
      buildQuestion(market.id, { kind: 'nemesis_bonus', questionDate: null, status: 'revealed' }),
    );
    await db.insert(pairingQuestions).values({ pairingId, questionId: question.id });
    // profile A picked and won; profile B picked and lost.
    await db.insert(picks).values([
      { id: uuidv7(), questionId: question.id, profileId: a.profileId, side: 'yes', yesPriceAtEntry: 0.6, priceStampedAt: NOW, result: 'win', edge: 0.4 },
      { id: uuidv7(), questionId: question.id, profileId: b.profileId, side: 'no', yesPriceAtEntry: 0.6, priceStampedAt: NOW, result: 'loss', edge: -0.6 },
    ]);

    await applyBlock(db, a.profileId, b.profileId, NOW);

    const [pairing] = await db.select().from(nemesisPairings).where(eq(nemesisPairings.id, pairingId));
    expect(pairing?.status).toBe('completed');
    expect(pairing?.scoreA).toBe(1);
    expect(pairing?.scoreB).toBe(0);
    expect(pairing?.winnerProfileId).toBe(a.profileId);
    expect(pairing?.ratingAppliedAt).not.toBeNull();

    const [ratingA] = await db.select().from(ratings).where(eq(ratings.profileId, a.profileId));
    const [ratingB] = await db.select().from(ratings).where(eq(ratings.profileId, b.profileId));
    expect(ratingA!.glickoRating).toBeGreaterThan(1500); // winner's rating rises
    expect(ratingB!.glickoRating).toBeLessThan(1500); // loser's rating falls
    expect(ratingA!.gamesCount).toBe(1);
    expect(ratingB!.gamesCount).toBe(1);

    const notifs = await db.select().from(notifications);
    expect(notifs).toHaveLength(2);
  });

  it('counts the week\'s graded DAILY questions as shared — a block cannot cancel a week already lost on dailies', async () => {
    // Regression for the WS5-T1-flagged gap: applyBlock originally read only the pairing's
    // nemesis_bonus questions (pairing_questions), so a graded daily — 7 of the week's ~7-10
    // shared questions — was invisible and the pairing cancelled with no rating effect,
    // erasing a week the blocker was losing. Same fixture as the bonus test above, but the
    // graded question is a plain daily inside the pairing's week, never linked via
    // pairing_questions.
    const { a, b, pairingId } = await makeActivePairing();

    const market = await insertMarket(db, buildMarket());
    const question = await insertQuestion(
      db,
      buildQuestion(market.id, { kind: 'daily', questionDate: '2026-07-21', status: 'revealed' }),
    );
    // blocked profile B won the daily; blocker A lost — the block must not erase this.
    await db.insert(picks).values([
      { id: uuidv7(), questionId: question.id, profileId: a.profileId, side: 'no', yesPriceAtEntry: 0.6, priceStampedAt: NOW, result: 'loss', edge: -0.6 },
      { id: uuidv7(), questionId: question.id, profileId: b.profileId, side: 'yes', yesPriceAtEntry: 0.6, priceStampedAt: NOW, result: 'win', edge: 0.4 },
    ]);

    await applyBlock(db, a.profileId, b.profileId, NOW);

    const [pairing] = await db.select().from(nemesisPairings).where(eq(nemesisPairings.id, pairingId));
    expect(pairing?.status).toBe('completed'); // NOT cancelled — the daily counts
    expect(pairing?.scoreA).toBe(0);
    expect(pairing?.scoreB).toBe(1);
    expect(pairing?.winnerProfileId).toBe(b.profileId);

    const [ratingA] = await db.select().from(ratings).where(eq(ratings.profileId, a.profileId));
    const [ratingB] = await db.select().from(ratings).where(eq(ratings.profileId, b.profileId));
    expect(ratingA!.glickoRating).toBeLessThan(1500); // the blocker still takes the loss
    expect(ratingB!.glickoRating).toBeGreaterThan(1500);
  });
});
