/**
 * WS6-T2 integration: `applyDuoMidWindowExit` (§5.7, §8.9) against a real Postgres — the duo
 * analogue of `moderation.test.ts`'s "applyBlock / pairing mid-week exit" suite. Also verifies
 * `applyBlock` (`apps/web/lib/moderation.ts`) actually calls it for the blocked profile, since
 * that's this task's one change to already-shipped WS11-T3 code.
 *
 * Route-level tests (the admin `suspend` action, `DELETE /api/v1/me`) are intentionally NOT
 * included here — `duo-queue.test.ts`'s own header note documents why: route auth (Auth.js
 * session resolution) isn't mocked anywhere in this repo yet, so every duo integration test in
 * this codebase exercises the `lib/` functions directly instead of the Next.js route handlers.
 * Both routes' wiring is a one-line call to the same `applyDuoMidWindowExit` this file tests.
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
  duoMatchQuestions,
  duoMatches,
  duos,
  markets,
  notifications,
  picks,
  profiles,
  questions,
  type Db,
  type ProfileRow,
} from '@receipts/db';
import { buildMarket, buildProfile } from '@receipts/db/testing';
import { applyDuoMidWindowExit } from '@/lib/duo-match-lifecycle';
import { applyBlock } from '@/lib/moderation';

const dbUrl =
  process.env.TEST_DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts_test';

const NOW = new Date('2026-07-21T18:00:00Z');

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
    sql`TRUNCATE TABLE duo_match_questions, duo_matches, duos, blocks, notifications, picks, questions, markets, profiles RESTART IDENTITY CASCADE`,
  );
});

async function makeClaimedProfile(): Promise<ProfileRow> {
  const row = buildProfile({ kind: 'claimed', status: 'active' });
  const [inserted] = await db.insert(profiles).values(row).returning();
  return inserted!;
}

async function makeDuo(memberAId: string, memberBId: string, glickoRating = 1500): Promise<string> {
  const id = uuidv7();
  await db.insert(duos).values({
    id,
    profileAId: memberAId < memberBId ? memberAId : memberBId,
    profileBId: memberAId < memberBId ? memberBId : memberAId,
    status: 'active',
    tier: 1,
    glickoRating,
    glickoRd: 350,
  });
  return id;
}

async function makeActiveMatch(duoAId: string, duoBId: string): Promise<string> {
  const id = uuidv7();
  await db.insert(duoMatches).values({
    id,
    duoAId,
    duoBId,
    windowStart: '2026-07-21',
    windowEnd: '2026-07-23',
    status: 'active',
  });
  return id;
}

describe('applyDuoMidWindowExit (§5.7, §8.9)', () => {
  it('cancels the match with no rating change when no shared question has graded', async () => {
    const [a1, a2, b1, b2] = await Promise.all([
      makeClaimedProfile(),
      makeClaimedProfile(),
      makeClaimedProfile(),
      makeClaimedProfile(),
    ]);
    const duoAId = await makeDuo(a1.id, a2.id, 1500);
    const duoBId = await makeDuo(b1.id, b2.id, 1500);
    const matchId = await makeActiveMatch(duoAId, duoBId);

    await applyDuoMidWindowExit(db, a1.id, NOW);

    const [match] = await db.select().from(duoMatches).where(eq(duoMatches.id, matchId));
    expect(match!.status).toBe('cancelled');
    expect(match!.winnerDuoId).toBeNull();
    expect(match!.ratingAppliedAt).toBeNull();

    const [duoA] = await db.select().from(duos).where(eq(duos.id, duoAId));
    expect(duoA!.glickoRating).toBe(1500); // unchanged
    expect(duoA!.matchesPlayed).toBe(0); // a cancelled match never counts as played

    const notifs = await db.select().from(notifications).where(sql`${notifications.kind} = 'duo_match_ended_early'`);
    expect(notifs.map((n) => n.profileId).sort()).toEqual([a1.id, a2.id, b1.id, b2.id].sort());
  });

  it('early-concludes with real scoring + immediate rating + chemistry when a shared question has graded', async () => {
    const [a1, a2, b1, b2] = await Promise.all([
      makeClaimedProfile(),
      makeClaimedProfile(),
      makeClaimedProfile(),
      makeClaimedProfile(),
    ]);
    const duoAId = await makeDuo(a1.id, a2.id, 1500);
    const duoBId = await makeDuo(b1.id, b2.id, 1500);
    const matchId = await makeActiveMatch(duoAId, duoBId);

    const [market] = await db.insert(markets).values(buildMarket({ status: 'resolved', outcome: 'yes' })).returning();
    const questionId = uuidv7();
    await db.insert(questions).values({
      id: questionId,
      kind: 'duo_bonus',
      marketId: market!.id,
      questionDate: null,
      slug: `duo-bonus-${questionId}`,
      headline: 'Test',
      yesLabel: 'Yes',
      noLabel: 'No',
      openAt: NOW,
      lockAt: NOW,
      revealAt: NOW,
      status: 'revealed', // §8.8.1: bonus questions publish immediately, no held reveal
      outcome: 'yes',
      settledAt: NOW,
      revealedAt: NOW,
    });
    await db.insert(duoMatchQuestions).values({ matchId, questionId });
    // duoA wins this one (a1 picked yes/won), duoB loses it (b1 picked no/lost) — a clean win
    // for duoA on the only graded question.
    await db.insert(picks).values([
      { id: uuidv7(), questionId, profileId: a1.id, side: 'yes', yesPriceAtEntry: 0.5, priceStampedAt: NOW, result: 'win', edge: 0.5 },
      { id: uuidv7(), questionId, profileId: b1.id, side: 'no', yesPriceAtEntry: 0.5, priceStampedAt: NOW, result: 'loss', edge: -0.5 },
    ]);

    await applyDuoMidWindowExit(db, b1.id, NOW); // triggered from the OTHER side's perspective — still finds the same match

    const [match] = await db.select().from(duoMatches).where(eq(duoMatches.id, matchId));
    expect(match!.status).toBe('completed');
    expect(match!.scoreA).toBe(1);
    expect(match!.scoreB).toBe(0);
    expect(match!.winnerDuoId).toBe(duoAId);
    expect(match!.ratingAppliedAt).not.toBeNull(); // early conclusion applies rating immediately (unlike normal completion)

    const [duoA] = await db.select().from(duos).where(eq(duos.id, duoAId));
    const [duoB] = await db.select().from(duos).where(eq(duos.id, duoBId));
    expect(duoA!.glickoRating).toBeGreaterThan(1500);
    expect(duoB!.glickoRating).toBeLessThan(1500);
    expect(duoA!.matchesPlayed).toBe(1);
    expect(duoB!.matchesPlayed).toBe(1);
    expect(duoA!.jointHitRate).not.toBeNull(); // chemistry refreshed as a side effect

    const notifs = await db.select().from(notifications).where(sql`${notifications.kind} = 'duo_match_ended_early'`);
    expect(notifs).toHaveLength(4);
  });

  it('is a no-op when the profile has no active duo match', async () => {
    const lone = await makeClaimedProfile();
    await expect(applyDuoMidWindowExit(db, lone.id, NOW)).resolves.toBeUndefined();
  });
});

describe('applyBlock wires in the duo mid-window exit for the blocked profile (§5.7)', () => {
  it("cancels the BLOCKED profile's active duo match (not the blocker's), no rating change", async () => {
    // `blocker` has no duo of its own at all here — proves the check runs off the blocked
    // profile, mirroring the nemesis precedent's own blocked-profile-only scope
    // (`findActivePairingInvolving(tx, blockedProfileId)` in moderation.ts).
    const blocker = await makeClaimedProfile();
    const blockedPartner = await makeClaimedProfile();
    const blockedOther = await makeClaimedProfile();
    const opponentA = await makeClaimedProfile();
    const opponentB = await makeClaimedProfile();

    const blockedDuoId = await makeDuo(blockedPartner.id, blockedOther.id, 1500);
    const opponentDuoId = await makeDuo(opponentA.id, opponentB.id, 1500);
    const matchId = await makeActiveMatch(blockedDuoId, opponentDuoId);

    await applyBlock(db, blocker.id, blockedPartner.id, NOW);

    const [match] = await db.select().from(duoMatches).where(eq(duoMatches.id, matchId));
    expect(match!.status).toBe('cancelled'); // no shared question graded → cancelled, no rating effect
  });
});
