/**
 * Audit findings 3.1/3.2 integration: `deleteClaimedAccount` (`@/lib/account-deletion`, §11.4)
 * against a real Postgres — deletion must apply the §5.7 mid-week exit to the deleting
 * profile's active NEMESIS pairing (the previously-missing half) and active DUO match, then run
 * `deleteAccount`, all in one transaction. Mirrors `moderation.test.ts`'s applyBlock suite: a
 * losing player must not be able to erase a loss by deleting their account.
 *
 * Route-level coverage (`DELETE /api/v1/me`) is intentionally NOT here —
 * `duo-match-lifecycle.test.ts`'s header documents the repo-wide pattern (route auth isn't
 * mocked anywhere; integration tests exercise the `lib/` functions the routes one-line into).
 *
 * Connects via TEST_DATABASE_URL (CI sets this to receipts_test — see every other integration
 * test's fallback default).
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
  duoMatches,
  duos,
  insertMarket,
  insertQuestion,
  nemesisPairings,
  notifications,
  picks,
  profiles,
  ratings,
  seasons,
  users,
  type Db,
} from '@receipts/db';
import { buildMarket, buildProfile, buildQuestion } from '@receipts/db/testing';
import { deleteClaimedAccount } from '@/lib/account-deletion';

const url =
  process.env.TEST_DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts_test';

const NOW = new Date('2026-07-22T15:00:00Z'); // mid-week of the 2026-07-20 pairing week

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
    sql`TRUNCATE duo_match_questions, duo_matches, duos, notifications, nemesis_pairings, pairing_questions, ratings, fingerprints, picks, questions, markets, profiles, users, seasons RESTART IDENTITY CASCADE`,
  );
});

async function makeClaimedProfile() {
  const userId = uuidv7();
  await db.insert(users).values({ id: userId, email: `${userId}@example.com` });
  const profile = buildProfile({ kind: 'claimed', userId });
  await db.insert(profiles).values(profile);
  return { userId, profileId: profile.id as string };
}

/** Same fixture as moderation.test.ts's makeActivePairing — deleter is profile A. */
async function makeActivePairing() {
  const deleter = await makeClaimedProfile();
  const survivor = await makeClaimedProfile();
  const seasonId = uuidv7();
  await db.insert(seasons).values({ id: seasonId, kind: 'nemesis', startsOn: '2026-07-20', endsOn: '2026-12-31', name: 'Test season' });
  const pairingId = uuidv7();
  await db.insert(nemesisPairings).values({
    id: pairingId,
    seasonId,
    weekStart: '2026-07-20',
    profileAId: deleter.profileId,
    profileBId: survivor.profileId,
    status: 'active',
  });
  await db.insert(ratings).values([{ profileId: deleter.profileId }, { profileId: survivor.profileId }]);
  return { deleter, survivor, pairingId };
}

async function expectAccountGone(profileId: string, userId: string) {
  const [profile] = await db.select().from(profiles).where(eq(profiles.id, profileId));
  expect(profile!.status).toBe('deleted');
  expect(profile!.handle).toBe(`deleted-${profileId}`);
  const userRows = await db.select().from(users).where(eq(users.id, userId));
  expect(userRows).toHaveLength(0);
}

describe('deleteClaimedAccount / nemesis mid-week exit (§11.4 → §5.7, audit 3.1)', () => {
  it('early-concludes an active pairing with real scoring when a shared daily has graded — deletion cannot erase a loss', async () => {
    const { deleter, survivor, pairingId } = await makeActivePairing();

    // A graded DAILY inside the pairing week (shared by date, not via pairing_questions):
    // the deleter LOST it, the survivor won — exactly the week a loser would want to erase.
    const market = await insertMarket(db, buildMarket());
    const question = await insertQuestion(
      db,
      buildQuestion(market.id, { kind: 'daily', questionDate: '2026-07-21', status: 'revealed' }),
    );
    await db.insert(picks).values([
      { id: uuidv7(), questionId: question.id, profileId: deleter.profileId, side: 'no', yesPriceAtEntry: 0.6, priceStampedAt: NOW, result: 'loss', edge: -0.6 },
      { id: uuidv7(), questionId: question.id, profileId: survivor.profileId, side: 'yes', yesPriceAtEntry: 0.6, priceStampedAt: NOW, result: 'win', edge: 0.4 },
    ]);

    await deleteClaimedAccount(db, deleter.profileId, deleter.userId, NOW);

    // Pairing completed with the real result — never dangling `active`, never cancelled.
    const [pairing] = await db.select().from(nemesisPairings).where(eq(nemesisPairings.id, pairingId));
    expect(pairing!.status).toBe('completed');
    expect(pairing!.scoreA).toBe(0);
    expect(pairing!.scoreB).toBe(1);
    expect(pairing!.winnerProfileId).toBe(survivor.profileId);
    expect(pairing!.ratingAppliedAt).not.toBeNull();

    // The survivor got the win's rating (the deleter's ratings row is then deleted per §11.4,
    // but only AFTER the exit scored the week — the pairing verdict above is the proof).
    const [survivorRating] = await db.select().from(ratings).where(eq(ratings.profileId, survivor.profileId));
    expect(survivorRating!.glickoRating).toBeGreaterThan(1500);
    expect(survivorRating!.gamesCount).toBe(1);
    const deleterRatings = await db.select().from(ratings).where(eq(ratings.profileId, deleter.profileId));
    expect(deleterRatings).toHaveLength(0);

    // §14.3 neutral notification: queued for the survivor; the deleted profile's copy was
    // cancelled by deleteAccount's queued-notification cleanup (a deleted account is never notified).
    const notifs = await db.select().from(notifications).where(eq(notifications.kind, 'pairing_ended_early'));
    expect(notifs.find((n) => n.profileId === survivor.profileId)?.status).toBe('queued');
    expect(notifs.find((n) => n.profileId === deleter.profileId)?.status).toBe('cancelled');

    await expectAccountGone(deleter.profileId, deleter.userId);
  });

  it('cancels an active pairing with no rating change when nothing has graded yet', async () => {
    const { deleter, survivor, pairingId } = await makeActivePairing();

    await deleteClaimedAccount(db, deleter.profileId, deleter.userId, NOW);

    const [pairing] = await db.select().from(nemesisPairings).where(eq(nemesisPairings.id, pairingId));
    expect(pairing!.status).toBe('cancelled');
    expect(pairing!.winnerProfileId).toBeNull();
    expect(pairing!.ratingAppliedAt).toBeNull();

    const [survivorRating] = await db.select().from(ratings).where(eq(ratings.profileId, survivor.profileId));
    expect(survivorRating!.glickoRating).toBe(1500); // unchanged default
    expect(survivorRating!.gamesCount).toBe(0);

    const notifs = await db.select().from(notifications).where(eq(notifications.kind, 'pairing_ended_early'));
    expect(notifs.find((n) => n.profileId === survivor.profileId)?.status).toBe('queued');
    expect(notifs.find((n) => n.profileId === deleter.profileId)?.status).toBe('cancelled');

    await expectAccountGone(deleter.profileId, deleter.userId);
  });

  it('still applies the duo mid-window exit too (route behavior preserved through the wrapper)', async () => {
    const deleter = await makeClaimedProfile();
    const partner = await makeClaimedProfile();
    const oppA = await makeClaimedProfile();
    const oppB = await makeClaimedProfile();

    const duoAId = uuidv7();
    const duoBId = uuidv7();
    await db.insert(duos).values([
      {
        id: duoAId,
        profileAId: deleter.profileId < partner.profileId ? deleter.profileId : partner.profileId,
        profileBId: deleter.profileId < partner.profileId ? partner.profileId : deleter.profileId,
        status: 'active',
        tier: 1,
        glickoRating: 1500,
        glickoRd: 350,
      },
      {
        id: duoBId,
        profileAId: oppA.profileId < oppB.profileId ? oppA.profileId : oppB.profileId,
        profileBId: oppA.profileId < oppB.profileId ? oppB.profileId : oppA.profileId,
        status: 'active',
        tier: 1,
        glickoRating: 1500,
        glickoRd: 350,
      },
    ]);
    const matchId = uuidv7();
    await db.insert(duoMatches).values({
      id: matchId,
      duoAId,
      duoBId,
      windowStart: '2026-07-21',
      windowEnd: '2026-07-23',
      status: 'active',
    });

    await deleteClaimedAccount(db, deleter.profileId, deleter.userId, NOW);

    const [match] = await db.select().from(duoMatches).where(eq(duoMatches.id, matchId));
    expect(match!.status).toBe('cancelled'); // nothing graded → cancelled, no rating effect

    // Surviving duo members keep their queued notification; the deleted member's is cancelled.
    const notifs = await db.select().from(notifications).where(eq(notifications.kind, 'duo_match_ended_early'));
    expect(notifs.find((n) => n.profileId === partner.profileId)?.status).toBe('queued');
    expect(notifs.find((n) => n.profileId === deleter.profileId)?.status).toBe('cancelled');

    await expectAccountGone(deleter.profileId, deleter.userId);
  });

  it('is a plain §11.4 deletion when the profile has no active pairing or duo match', async () => {
    const lone = await makeClaimedProfile();

    await deleteClaimedAccount(db, lone.profileId, lone.userId, NOW);

    await expectAccountGone(lone.profileId, lone.userId);
    expect(await db.select().from(nemesisPairings)).toHaveLength(0);
    expect(await db.select().from(duoMatches)).toHaveLength(0);
  });
});
