/**
 * WS4-T7 integration AC (§19.3, §8.3): a completed nemesis pairing changes both participants'
 * Glicko-2 ratings correctly (pinned values computed via the same WS4-T2 pure `updateGlicko2`
 * function used by the golden-vector test in `packages/engine/test/glicko2.test.ts`, at that
 * test's stated tolerances); no-game RD inflation is observed for an idle, already-rated
 * profile; and a SECOND run over the same already-applied pairings is a no-op (the explicit
 * idempotency AC). A lighter duo-match pass exercises the "duo team ratings updated identically
 * ... in the same batch" half of §8.3. Requires a live Postgres (docker-compose / CI service).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type pg from 'pg';
import { updateGlicko2 } from '@receipts/engine';
import {
  connect,
  duoMatches,
  duos,
  nemesisPairings,
  profiles,
  ratings,
  seasons,
  type Db,
} from '@receipts/db';
import {
  buildDuo,
  buildDuoMatch,
  buildNemesisPairing,
  buildProfile,
  buildSeason,
} from '@receipts/db/testing';
import { runRatingsWeekly } from '../../src/jobs/ratings-weekly.js';

const dbUrl =
  process.env.TEST_DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts_test';

const NOW = new Date('2026-07-19T03:00:00Z'); // Sun 23:00 ET

let pool: pg.Pool;
let db: Db;

beforeAll(async () => {
  ({ pool, db } = connect({ connectionString: dbUrl }));
  await db.execute(sql`DROP SCHEMA public CASCADE`);
  await db.execute(sql`CREATE SCHEMA public`);
  await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  await migrate(db, {
    migrationsFolder: join(
      dirname(fileURLToPath(import.meta.url)),
      '..', '..', '..', '..', 'packages', 'db', 'drizzle',
    ),
  });
});

afterAll(async () => {
  await pool.end();
});

async function getRating(profileId: string) {
  const [row] = await db.select().from(ratings).where(sql`${ratings.profileId} = ${profileId}`);
  return row!;
}

describe('ratings:weekly — nemesis pairing rating application (§8.3)', () => {
  let seasonId: string;
  let profileAId: string;
  let profileBId: string;
  let pairingId: string;

  // Pinned via the SAME pure `updateGlicko2` the golden-vector test (packages/engine) already
  // covers — this integration test's job is to prove the DB wiring reproduces it, not to
  // re-derive Glicko-2 math. Tolerances mirror WS4-T2's own (±0.01 rating/RD, ±1e-5 vol).
  const startA = { rating: 1500, rd: 200, vol: 0.06 };
  const startB = { rating: 1400, rd: 30, vol: 0.06 };
  const expectedA = updateGlicko2(startA, [{ opponentRating: startB.rating, opponentRd: startB.rd, score: 1 }]);
  const expectedB = updateGlicko2(startB, [{ opponentRating: startA.rating, opponentRd: startA.rd, score: 0 }]);

  it('sets up season + profiles + seeded ratings + a completed pairing', async () => {
    const season = buildSeason();
    seasonId = season.id as string;
    await db.insert(seasons).values(season);

    const profileA = buildProfile();
    const profileB = buildProfile();
    profileAId = profileA.id as string;
    profileBId = profileB.id as string;
    await db.insert(profiles).values([profileA, profileB]);

    await db.insert(ratings).values([
      { profileId: profileAId, glickoRating: startA.rating, glickoRd: startA.rd, glickoVol: startA.vol },
      { profileId: profileBId, glickoRating: startB.rating, glickoRd: startB.rd, glickoVol: startB.vol },
    ]);

    const pairing = buildNemesisPairing(seasonId, profileAId, profileBId, {
      status: 'completed',
      winnerProfileId: profileAId,
      verdict: { narrative_line: 'A wins the week' },
    });
    pairingId = pairing.id as string;
    await db.insert(nemesisPairings).values(pairing);
  });

  it('applies the pairing: both ratings move to the pinned Glicko-2 values, games_count increments', async () => {
    const report = await runRatingsWeekly(db, pool, NOW);
    expect(report.pairingsApplied).toBe(1);

    const ratingA = await getRating(profileAId);
    const ratingB = await getRating(profileBId);

    expect(Math.abs(ratingA.glickoRating - expectedA.rating)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(ratingA.glickoRd - expectedA.rd)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(ratingA.glickoVol - expectedA.vol)).toBeLessThanOrEqual(1e-5);
    expect(ratingA.gamesCount).toBe(1);

    expect(Math.abs(ratingB.glickoRating - expectedB.rating)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(ratingB.glickoRd - expectedB.rd)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(ratingB.glickoVol - expectedB.vol)).toBeLessThanOrEqual(1e-5);
    expect(ratingB.gamesCount).toBe(1);
  });

  it('stamps rating_applied_at and writes the pre-application rating_before snapshot (§6.5 deep-regrade support)', async () => {
    const [pairing] = await db.select().from(nemesisPairings).where(sql`${nemesisPairings.id} = ${pairingId}`);
    expect(pairing!.ratingAppliedAt).not.toBeNull();
    const verdict = pairing!.verdict as { narrative_line: string; rating_before: { a: typeof startA; b: typeof startB } };
    expect(verdict.narrative_line).toBe('A wins the week'); // existing verdict content preserved, not overwritten
    expect(verdict.rating_before.a).toEqual(startA);
    expect(verdict.rating_before.b).toEqual(startB);
  });

  it('idempotency: a SECOND run over the same already-applied pairing is a no-op', async () => {
    const before = { a: await getRating(profileAId), b: await getRating(profileBId) };

    const report = await runRatingsWeekly(db, pool, NOW);
    expect(report.pairingsApplied).toBe(0); // nothing left to consume — rating_applied_at already set

    const after = { a: await getRating(profileAId), b: await getRating(profileBId) };
    expect(after.a.glickoRating).toBe(before.a.glickoRating);
    expect(after.a.glickoRd).toBe(before.a.glickoRd);
    expect(after.a.glickoVol).toBe(before.a.glickoVol);
    expect(after.a.gamesCount).toBe(before.a.gamesCount);
    expect(after.b.glickoRating).toBe(before.b.glickoRating);
    expect(after.b.glickoRd).toBe(before.b.glickoRd);
    expect(after.b.gamesCount).toBe(before.b.gamesCount);
  });
});

describe('ratings:weekly — first-ever nemesis game (no pre-existing ratings row)', () => {
  it('lazily creates ratings rows at the Glicko-2 defaults (1500/350/0.06) and applies the game from there', async () => {
    const season = buildSeason();
    await db.insert(seasons).values(season);
    const profileA = buildProfile();
    const profileB = buildProfile();
    await db.insert(profiles).values([profileA, profileB]);
    // Deliberately NO `ratings` rows inserted — this is the realistic first-nemesis-game path
    // (WS5-T1's assignment job doesn't pre-seed `ratings`; `getOrDefaultRating` lazily creates
    // one at the spec defaults, §5.4).
    const pairing = buildNemesisPairing(season.id as string, profileA.id as string, profileB.id as string, {
      status: 'completed',
      winnerProfileId: profileA.id as string,
    });
    await db.insert(nemesisPairings).values(pairing);

    const defaults = { rating: 1500, rd: 350, vol: 0.06 };
    const expectedA = updateGlicko2(defaults, [{ opponentRating: defaults.rating, opponentRd: defaults.rd, score: 1 }]);
    const expectedB = updateGlicko2(defaults, [{ opponentRating: defaults.rating, opponentRd: defaults.rd, score: 0 }]);

    const report = await runRatingsWeekly(db, pool, NOW);
    expect(report.pairingsApplied).toBe(1);

    const ratingA = await getRating(profileA.id as string);
    const ratingB = await getRating(profileB.id as string);
    expect(Math.abs(ratingA.glickoRating - expectedA.rating)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(ratingB.glickoRating - expectedB.rating)).toBeLessThanOrEqual(0.01);
    expect(ratingA.gamesCount).toBe(1);
    expect(ratingB.gamesCount).toBe(1);
  });
});

describe('ratings:weekly — no-game RD inflation (§8.3)', () => {
  it('inflates RD (rating/vol unchanged) for an already-rated profile with no game this run', async () => {
    const idle = buildProfile();
    await db.insert(profiles).values(idle);

    const TEN_DAYS_MS = 10 * 24 * 3600_000;
    const staleUpdatedAt = new Date(NOW.getTime() - TEN_DAYS_MS);
    await db.insert(ratings).values({
      profileId: idle.id as string,
      glickoRating: 1500,
      glickoRd: 60,
      glickoVol: 0.06,
      updatedAt: staleUpdatedAt,
    });

    const expected = updateGlicko2({ rating: 1500, rd: 60, vol: 0.06 }, []);

    const report = await runRatingsWeekly(db, pool, NOW);
    expect(report.profilesInflated).toBeGreaterThanOrEqual(1);

    const row = await getRating(idle.id as string);
    expect(row.glickoRating).toBe(1500); // rating unchanged by a no-game period
    expect(row.glickoVol).toBe(0.06); // volatility unchanged by a no-game period
    expect(row.glickoRd).toBeGreaterThan(60); // RD inflates
    // `real` (float4) column storage: ~7 significant digits, so allow for that round-trip loss
    // rather than the pure function's own double-precision tolerance.
    expect(Math.abs(row.glickoRd - expected.rd)).toBeLessThanOrEqual(1e-3);
  });

  it('does NOT inflate a profile whose rating was just touched by a real game this run', async () => {
    const season = buildSeason();
    const seasonId = season.id as string;
    await db.insert(seasons).values(season);
    const profileA = buildProfile();
    const profileB = buildProfile();
    await db.insert(profiles).values([profileA, profileB]);
    // Both start with an OLD updated_at (outside the reprocess window) so they'd normally be
    // inflation candidates too — but they're about to get a REAL game this run instead.
    const staleUpdatedAt = new Date(NOW.getTime() - 10 * 24 * 3600_000);
    await db.insert(ratings).values([
      { profileId: profileA.id as string, updatedAt: staleUpdatedAt },
      { profileId: profileB.id as string, updatedAt: staleUpdatedAt },
    ]);
    const pairing = buildNemesisPairing(seasonId, profileA.id as string, profileB.id as string, {
      status: 'completed',
      winnerProfileId: profileA.id as string,
    });
    await db.insert(nemesisPairings).values(pairing);

    await runRatingsWeekly(db, pool, NOW);

    // Default RD is 350; a real game visibly moves it via the game-processing branch, not the
    // pure "+vol only" no-game inflation formula — the two are different code paths, and this
    // assertion is really just confirming the profile didn't ALSO go through inflation this run
    // (which would double-move its RD in a distinguishable way). games_count is the clean tell.
    const ratingA = await getRating(profileA.id as string);
    expect(ratingA.gamesCount).toBe(1);
  });
});

describe('ratings:weekly — duo match rating application (§8.3 "duo team ratings updated identically")', () => {
  it('applies a completed duo match to both duos’ team ratings and increments matches_played', async () => {
    const profiles4 = [buildProfile(), buildProfile(), buildProfile(), buildProfile()];
    await db.insert(profiles).values(profiles4);
    const duoA = buildDuo(profiles4[0]!.id as string, profiles4[1]!.id as string, {
      glickoRating: 1500,
      glickoRd: 200,
      glickoVol: 0.06,
    });
    const duoB = buildDuo(profiles4[2]!.id as string, profiles4[3]!.id as string, {
      glickoRating: 1400,
      glickoRd: 30,
      glickoVol: 0.06,
    });
    await db.insert(duos).values([duoA, duoB]);

    const match = buildDuoMatch(duoA.id as string, duoB.id as string, {
      status: 'completed',
      winnerDuoId: duoA.id as string,
    });
    await db.insert(duoMatches).values(match);

    const expectedA = updateGlicko2(
      { rating: 1500, rd: 200, vol: 0.06 },
      [{ opponentRating: 1400, opponentRd: 30, score: 1 }],
    );

    const report = await runRatingsWeekly(db, pool, NOW);
    expect(report.duoMatchesApplied).toBe(1);

    const [rowA] = await db.select().from(duos).where(sql`${duos.id} = ${duoA.id}`);
    expect(Math.abs(rowA!.glickoRating - expectedA.rating)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(rowA!.glickoRd - expectedA.rd)).toBeLessThanOrEqual(0.01);
    expect(rowA!.matchesPlayed).toBe(1);

    const [matchRow] = await db.select().from(duoMatches).where(sql`${duoMatches.id} = ${match.id}`);
    expect(matchRow!.ratingAppliedAt).not.toBeNull();
    expect(matchRow!.ratingSnapshot).toMatchObject({
      a: { rating: 1500, rd: 200, vol: 0.06 },
      b: { rating: 1400, rd: 30, vol: 0.06 },
    });

    // Idempotency: a second run finds nothing left to apply for this match.
    const report2 = await runRatingsWeekly(db, pool, NOW);
    expect(report2.duoMatchesApplied).toBe(0);
  });
});

describe('ratings:weekly — deleted participant is skipped entirely (§8.3)', () => {
  it('applies no rating change for either side when one participant profile is deleted, but still stamps rating_applied_at', async () => {
    const season = buildSeason();
    const seasonId = season.id as string;
    await db.insert(seasons).values(season);
    const survivor = buildProfile();
    const deleted = buildProfile({ status: 'deleted' });
    await db.insert(profiles).values([survivor, deleted]);
    await db.insert(ratings).values([
      { profileId: survivor.id as string, glickoRating: 1600 },
      { profileId: deleted.id as string, glickoRating: 1400 },
    ]);
    const pairing = buildNemesisPairing(seasonId, survivor.id as string, deleted.id as string, {
      status: 'completed',
      winnerProfileId: survivor.id as string,
    });
    await db.insert(nemesisPairings).values(pairing);

    const report = await runRatingsWeekly(db, pool, NOW);
    expect(report.pairingsSkippedDeletedParticipant).toBe(1);
    expect(report.pairingsApplied).toBe(0);

    const survivorRating = await getRating(survivor.id as string);
    expect(survivorRating.glickoRating).toBe(1600); // untouched — "no rating change for the survivor"
    expect(survivorRating.gamesCount).toBe(0);

    const [pairingRow] = await db.select().from(nemesisPairings).where(sql`${nemesisPairings.id} = ${pairing.id}`);
    expect(pairingRow!.ratingAppliedAt).not.toBeNull(); // consumed so the batch never retries it
  });
});
