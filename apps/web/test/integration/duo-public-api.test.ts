/**
 * WS6-T4 integration (§9.2 `GET /duos/:id`, `GET /duo/ladder`, `POST /duos/:id/disband`) against
 * a real Postgres — exercises `apps/web/lib/serialize-duo.ts`'s `getDuoPublicPage`,
 * `apps/web/lib/duo-ladder.ts`'s `getDuoLadderPage`, and `apps/web/lib/duo-disband.ts`'s
 * `disbandDuoForMember` directly rather than the Next.js route handlers — mirrors
 * `duo-queue.test.ts`/`duo-match-lifecycle.test.ts`'s own header note: route auth (Auth.js
 * session resolution) isn't mocked anywhere in this repo yet, so every duo integration test
 * exercises `lib/` functions directly. Each route's own wiring is a thin parse-then-delegate
 * layer with no extra logic of its own (see the route files themselves).
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
  markets,
  notifications,
  picks,
  profiles,
  questions,
  seasons,
  type Db,
  type ProfileRow,
} from '@receipts/db';
import { buildDuo, buildDuoMatch, buildMarket, buildProfile, buildSeason } from '@receipts/db/testing';
import { getDuoPublicPage } from '@/lib/serialize-duo';
import { getDuoLadderPage } from '@/lib/duo-ladder';
import { disbandDuoForMember } from '@/lib/duo-disband';

const dbUrl =
  process.env.TEST_DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts_test';

const NOW = new Date('2026-07-21T18:00:00Z'); // a Tuesday, mid Tue-Thu duo window

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
    sql`TRUNCATE TABLE duo_match_questions, duo_matches, duos, notifications, picks, questions, markets, profiles, seasons RESTART IDENTITY CASCADE`,
  );
});

async function makeClaimedProfile(): Promise<ProfileRow> {
  const [row] = await db.insert(profiles).values(buildProfile({ kind: 'claimed', status: 'active' })).returning();
  return row!;
}

async function makeDuo(memberAId: string, memberBId: string, overrides: Partial<typeof duos.$inferInsert> = {}): Promise<string> {
  const [a, b] = memberAId < memberBId ? [memberAId, memberBId] : [memberBId, memberAId];
  const [inserted] = await db.insert(duos).values(buildDuo(a, b, overrides)).returning();
  return inserted!.id;
}

async function makeMatch(duoAId: string, duoBId: string, overrides: Partial<typeof duoMatches.$inferInsert> = {}): Promise<string> {
  const [a, b] = duoAId < duoBId ? [duoAId, duoBId] : [duoBId, duoAId];
  const [inserted] = await db.insert(duoMatches).values(buildDuoMatch(a, b, overrides)).returning();
  return inserted!.id;
}

describe('getDuoPublicPage (§9.2 GET /duos/:id)', () => {
  it('returns null for an unknown duo id', async () => {
    await expect(getDuoPublicPage(db, uuidv7(), 50)).resolves.toBeNull();
  });

  it('returns the duo + only completed/cancelled matches, newest window first, excluding the live one', async () => {
    const [a, b] = await Promise.all([makeClaimedProfile(), makeClaimedProfile()]);
    const [x, y] = await Promise.all([makeClaimedProfile(), makeClaimedProfile()]);
    const duoId = await makeDuo(a.id, b.id, { tier: 2, glickoRating: 1550, matchesPlayed: 2 });
    const opponentId = await makeDuo(x.id, y.id);

    const oldCompleted = await makeMatch(duoId, opponentId, {
      windowStart: '2026-07-07',
      windowEnd: '2026-07-09',
      status: 'completed',
    });
    const recentCancelled = await makeMatch(duoId, opponentId, {
      windowStart: '2026-07-14',
      windowEnd: '2026-07-16',
      status: 'cancelled',
    });
    await makeMatch(duoId, opponentId, {
      windowStart: '2026-07-21',
      windowEnd: '2026-07-23',
      status: 'active', // the LIVE match — must not appear in match_history
    });

    const page = await getDuoPublicPage(db, duoId, 50);
    expect(page).not.toBeNull();
    expect(page!.duo.id).toBe(duoId);
    expect(page!.duo.tier).toBe(2);
    expect(page!.duo.partners.map((p) => p.profile_id).sort()).toEqual([a.id, b.id].sort());
    expect(page!.match_history.map((m) => m.id)).toEqual([recentCancelled, oldCompleted]); // newest first
  });

  it('still resolves a disbanded duo (public artifact, not hidden)', async () => {
    const [a, b] = await Promise.all([makeClaimedProfile(), makeClaimedProfile()]);
    const duoId = await makeDuo(a.id, b.id, { status: 'disbanded' });

    const page = await getDuoPublicPage(db, duoId, 50);
    expect(page!.duo.status).toBe('disbanded');
  });
});

describe('disbandDuoForMember (§8.5, §9.2 POST /duos/:id/disband)', () => {
  it('disbands and notifies only the partner when there is no active match', async () => {
    const [a, b] = await Promise.all([makeClaimedProfile(), makeClaimedProfile()]);
    const duoId = await makeDuo(a.id, b.id);

    const result = await disbandDuoForMember(db, duoId, a.id, NOW);
    expect(result).toEqual({ disbanded: true });

    const [duo] = await db.select().from(duos).where(eq(duos.id, duoId));
    expect(duo!.status).toBe('disbanded');

    const notifs = await db.select().from(notifications).where(sql`${notifications.kind} = 'duo_disbanded'`);
    expect(notifs).toHaveLength(1);
    expect(notifs[0]!.profileId).toBe(b.id); // the OTHER member, not the actor
  });

  it('is unilateral — either member can disband without the other approving anything', async () => {
    const [a, b] = await Promise.all([makeClaimedProfile(), makeClaimedProfile()]);
    const duoId = await makeDuo(a.id, b.id);

    // b (not a) disbands — no prior consent step required.
    await disbandDuoForMember(db, duoId, b.id, NOW);
    const [duo] = await db.select().from(duos).where(eq(duos.id, duoId));
    expect(duo!.status).toBe('disbanded');
    const notifs = await db.select().from(notifications).where(sql`${notifications.kind} = 'duo_disbanded'`);
    expect(notifs[0]!.profileId).toBe(a.id); // notifies the OTHER member (a)
  });

  it('rejects a non-member with FORBIDDEN', async () => {
    const [a, b, outsider] = await Promise.all([makeClaimedProfile(), makeClaimedProfile(), makeClaimedProfile()]);
    const duoId = await makeDuo(a.id, b.id);

    await expect(disbandDuoForMember(db, duoId, outsider.id, NOW)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    const [duo] = await db.select().from(duos).where(eq(duos.id, duoId));
    expect(duo!.status).toBe('active'); // untouched
  });

  it('404s for an unknown duo id', async () => {
    const someone = await makeClaimedProfile();
    await expect(disbandDuoForMember(db, uuidv7(), someone.id, NOW)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('404s when the duo is already disbanded', async () => {
    const [a, b] = await Promise.all([makeClaimedProfile(), makeClaimedProfile()]);
    const duoId = await makeDuo(a.id, b.id, { status: 'disbanded' });

    await expect(disbandDuoForMember(db, duoId, a.id, NOW)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('cancels a live match with no graded questions, applies no rating change, then disbands', async () => {
    const [a1, a2, b1, b2] = await Promise.all([
      makeClaimedProfile(),
      makeClaimedProfile(),
      makeClaimedProfile(),
      makeClaimedProfile(),
    ]);
    const duoAId = await makeDuo(a1.id, a2.id, { glickoRating: 1500 });
    const duoBId = await makeDuo(b1.id, b2.id, { glickoRating: 1500 });
    const matchId = await makeMatch(duoAId, duoBId, { status: 'active', scoreA: 0, scoreB: 0, winnerDuoId: null, ratingAppliedAt: null });

    await disbandDuoForMember(db, duoAId, a1.id, NOW);

    const [match] = await db.select().from(duoMatches).where(eq(duoMatches.id, matchId));
    expect(match!.status).toBe('cancelled'); // mid-window exit: no graded question -> cancelled
    expect(match!.ratingAppliedAt).toBeNull();

    const [duoA] = await db.select().from(duos).where(eq(duos.id, duoAId));
    expect(duoA!.status).toBe('disbanded');
    expect(duoA!.glickoRating).toBe(1500); // unchanged — cancellation applies no rating

    // Both the partner (duo_disbanded) and all 4 match participants (duo_match_ended_early) are
    // notified — two distinct facts, two distinct notification kinds.
    const disbandNotifs = await db.select().from(notifications).where(sql`${notifications.kind} = 'duo_disbanded'`);
    expect(disbandNotifs.map((n) => n.profileId)).toEqual([a2.id]);
    const exitNotifs = await db.select().from(notifications).where(sql`${notifications.kind} = 'duo_match_ended_early'`);
    expect(exitNotifs.map((n) => n.profileId).sort()).toEqual([a1.id, a2.id, b1.id, b2.id].sort());
  });

  it('early-concludes a live match with real scoring/rating when a shared question already graded, THEN disbands', async () => {
    const [a1, a2, b1, b2] = await Promise.all([
      makeClaimedProfile(),
      makeClaimedProfile(),
      makeClaimedProfile(),
      makeClaimedProfile(),
    ]);
    const duoAId = await makeDuo(a1.id, a2.id, { glickoRating: 1500 });
    const duoBId = await makeDuo(b1.id, b2.id, { glickoRating: 1500 });
    const matchId = await makeMatch(duoAId, duoBId, { status: 'active', scoreA: 0, scoreB: 0, winnerDuoId: null, ratingAppliedAt: null });

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
      status: 'revealed',
      outcome: 'yes',
      settledAt: NOW,
      revealedAt: NOW,
    });
    await db.execute(sql`INSERT INTO duo_match_questions (match_id, question_id) VALUES (${matchId}, ${questionId})`);
    await db.insert(picks).values([
      { id: uuidv7(), questionId, profileId: a1.id, side: 'yes', yesPriceAtEntry: 0.5, priceStampedAt: NOW, result: 'win', edge: 0.5 },
      { id: uuidv7(), questionId, profileId: b1.id, side: 'no', yesPriceAtEntry: 0.5, priceStampedAt: NOW, result: 'loss', edge: -0.5 },
    ]);

    // b2 (the LOSING duo's member) disbands mid-match — must NOT erase the loss (§5.7/§14.3).
    await disbandDuoForMember(db, duoBId, b2.id, NOW);

    const [match] = await db.select().from(duoMatches).where(eq(duoMatches.id, matchId));
    expect(match!.status).toBe('completed');
    expect(match!.winnerDuoId).toBe(duoAId);
    expect(match!.ratingAppliedAt).not.toBeNull();

    const [duoA] = await db.select().from(duos).where(eq(duos.id, duoAId));
    const [duoB] = await db.select().from(duos).where(eq(duos.id, duoBId));
    expect(duoA!.glickoRating).toBeGreaterThan(1500); // winner's rating went up
    expect(duoB!.glickoRating).toBeLessThan(1500); // the disbanding, LOSING duo's rating went down
    expect(duoB!.status).toBe('disbanded');
  });

  it('is race-safe: a second concurrent disband on the same duo sees it already disbanded, not a double side-effect', async () => {
    const [a, b] = await Promise.all([makeClaimedProfile(), makeClaimedProfile()]);
    const duoId = await makeDuo(a.id, b.id);

    const results = await Promise.allSettled([
      disbandDuoForMember(db, duoId, a.id, NOW),
      disbandDuoForMember(db, duoId, b.id, NOW),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: 'NOT_FOUND' });

    // Exactly one duo_disbanded notification exists — no double-send from the race.
    const notifs = await db.select().from(notifications).where(sql`${notifications.kind} = 'duo_disbanded'`);
    expect(notifs).toHaveLength(1);
  });
});

describe('getDuoLadderPage (§8.10, §9.2 GET /duo/ladder)', () => {
  it('ranks by season-scoped wins within the season covering `at`, hydrated to full duo public shape', async () => {
    await db.insert(seasons).values(buildSeason({ kind: 'duo', startsOn: '2026-07-21', endsOn: '2026-08-17' }));

    const [a1, a2, b1, b2, c1, c2] = await Promise.all([
      makeClaimedProfile(),
      makeClaimedProfile(),
      makeClaimedProfile(),
      makeClaimedProfile(),
      makeClaimedProfile(),
      makeClaimedProfile(),
    ]);
    const duoA = await makeDuo(a1.id, a2.id, { tier: 1, glickoRating: 1600 });
    const duoB = await makeDuo(b1.id, b2.id, { tier: 1, glickoRating: 1500 });
    const duoC = await makeDuo(c1.id, c2.id, { tier: 1, glickoRating: 1700 });

    // duoA: 2 wins in-season, duoB: 0 wins, duoC: 1 win — all within the season's date range.
    await makeMatch(duoA, duoB, { windowStart: '2026-07-21', windowEnd: '2026-07-23', status: 'completed', winnerDuoId: duoA });
    await makeMatch(duoA, duoC, { windowStart: '2026-07-24', windowEnd: '2026-07-26', status: 'completed', winnerDuoId: duoA });
    await makeMatch(duoB, duoC, { windowStart: '2026-07-28', windowEnd: '2026-07-30', status: 'completed', winnerDuoId: duoC });
    // A completed match BEFORE the season started must not count.
    await makeMatch(duoB, duoC, { windowStart: '2026-06-01', windowEnd: '2026-06-03', status: 'completed', winnerDuoId: duoB });

    const page = await getDuoLadderPage(db, {}, NOW);
    expect(page.data.map((e) => e.duo.id)).toEqual([duoA, duoC, duoB]); // 2 wins, 1 win, 0 wins
    expect(page.data.map((e) => e.rank)).toEqual([1, 2, 3]);
    expect(page.data.map((e) => e.wins)).toEqual([2, 1, 0]);
    expect(page.data[0]!.tier).toBe(1);
    expect(page.data[0]!.duo.partners).toHaveLength(2);
    expect(page.meta.next_cursor).toBeNull();
  });

  it('falls back to wins:0 for every active duo when no duo season exists yet', async () => {
    const [a, b] = await Promise.all([makeClaimedProfile(), makeClaimedProfile()]);
    await makeDuo(a.id, b.id, { tier: 1, glickoRating: 1500 });

    const page = await getDuoLadderPage(db, {}, NOW);
    expect(page.data).toHaveLength(1);
    expect(page.data[0]!.wins).toBe(0);
  });

  it('paginates with a next_cursor, and the second page picks up where the first left off', async () => {
    const members = await Promise.all(Array.from({ length: 6 }, () => makeClaimedProfile()));
    const duoIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      duoIds.push(await makeDuo(members[i * 2]!.id, members[i * 2 + 1]!.id, { tier: 1, glickoRating: 1500 + i }));
    }

    const first = await getDuoLadderPage(db, { limit: 2 }, NOW);
    expect(first.data).toHaveLength(2);
    expect(first.meta.next_cursor).not.toBeNull();

    const second = await getDuoLadderPage(db, { limit: 2, cursor: first.meta.next_cursor! }, NOW);
    expect(second.data).toHaveLength(1);
    expect(second.meta.next_cursor).toBeNull();

    const seenIds = [...first.data, ...second.data].map((e) => e.duo.id);
    expect(new Set(seenIds).size).toBe(3); // no duplicates/gaps across pages
    expect(seenIds.sort()).toEqual([...duoIds].sort());
  });

  it('filters to a single tier', async () => {
    const [a, b, c, d] = await Promise.all([makeClaimedProfile(), makeClaimedProfile(), makeClaimedProfile(), makeClaimedProfile()]);
    await makeDuo(a.id, b.id, { tier: 1 });
    const tier2Duo = await makeDuo(c.id, d.id, { tier: 2 });

    const page = await getDuoLadderPage(db, { tier: 2 }, NOW);
    expect(page.data.map((e) => e.duo.id)).toEqual([tier2Duo]);
  });
});
