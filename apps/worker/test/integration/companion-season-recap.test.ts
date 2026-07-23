/**
 * XH-T8 integration AC (docs/xtrace-hackathon-tasks.md): `companion:season-recap` against a real
 * Postgres, with fake xTrace/Generator clients capturing calls (no real network/LLM).
 *
 *  - A seeded season with 2 concluded pairings across 3 claimed profiles → 2 recap artifacts
 *    generated, 1 skipped (a scripted null from the fake generator) — the job still completes.
 *  - A rerun makes no new generator calls (idempotent via the pre-existing-artifact check AND
 *    `insertArtifactIdempotent`'s own `ON CONFLICT`).
 *  - Per-profile stats are pinned: win/loss/draw bucketing, the longest consecutive-WIN streak
 *    (a draw breaks the run), chronological verdict lines, and a non-`completed` pairing (e.g. the
 *    current active week) never leaking into any of it.
 *  - `calloutsSent`/`calloutsWon` use the season's ET-day window — a callout the day BEFORE
 *    `startsOn` is excluded, while ones landing on `startsOn` and on `endsOn` (the season's FIRST
 *    and LAST days) are both INCLUDED (pinning both edges of the exact off-by-one the spec warns
 *    a naive `created_at <= ends_on` cast would introduce).
 *  - An explicitly-given seasonId is recapped with no `endsOn` check (even a still-running
 *    season); an omitted seasonId resolves the latest ENDED nemesis season, never a running one.
 *
 * Connects via TEST_DATABASE_URL, same convention as `companion-ingest.test.ts`.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type pg from 'pg';
import { setTestClock } from '@receipts/core';
import {
  callouts,
  companionArtifacts,
  connect,
  nemesisPairings,
  profiles,
  seasons,
  type CompanionArtifactRow,
  type Db,
  type ProfileRow,
} from '@receipts/db';
import { buildCallout, buildNemesisPairing, buildProfile, buildSeason } from '@receipts/db/testing';
import type { Generator, RecapContext, XtraceClient } from '@receipts/companion';
import { runSeasonRecap } from '../../src/jobs/companion-season-recap.js';
import type { JobContext } from '../../src/context.js';

const dbUrl =
  process.env.TEST_DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts_test';

// A season whose window is fully in the past relative to AT (2026-07-24), so the "latest ended
// season" resolution path has something unambiguous to find.
const AT = new Date('2026-07-24T12:00:00Z');

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
      '..',
      '..',
      '..',
      '..',
      'packages',
      'db',
      'drizzle',
    ),
  });
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE companion_artifacts, callouts, nemesis_pairings, seasons, profiles RESTART IDENTITY CASCADE`,
  );
});

afterEach(() => {
  setTestClock(null);
});

function makeCtx(): JobContext {
  return {
    db,
    pool: undefined as unknown as JobContext['pool'],
    boss: undefined as unknown as JobContext['boss'],
    redis: undefined as unknown as JobContext['redis'],
  };
}

function makeFakeXtrace(): { client: XtraceClient; searchCalls: unknown[] } {
  const searchCalls: unknown[] = [];
  return {
    searchCalls,
    client: {
      async ingest() {
        return true;
      },
      async search(args) {
        searchCalls.push(args);
        return [];
      },
    },
  };
}

/** `skipHandles` makes `seasonRecap` return null for those handles (simulating a degraded/
 * money-word-filtered generation) — the job must skip exactly those profiles and keep going. */
function makeFakeGenerator(skipHandles: Set<string> = new Set()): {
  generator: Generator;
  calls: RecapContext[];
} {
  const calls: RecapContext[] = [];
  return {
    calls,
    generator: {
      banter: async () => null,
      calloutDrafts: async () => null,
      async seasonRecap(ctx) {
        calls.push(ctx);
        if (skipHandles.has(ctx.handle)) return null;
        return { title: `${ctx.handle}'s season`, paragraphs: [`stats logged for ${ctx.handle}`] };
      },
    },
  };
}

async function seedClaimedProfile(handle: string): Promise<ProfileRow> {
  const p = buildProfile({ kind: 'claimed', status: 'active', handle });
  const [row] = await db.insert(profiles).values(p).returning();
  return row!;
}

async function seedSeasonRow(startsOn: string, endsOn: string): Promise<string> {
  const s = buildSeason({ startsOn, endsOn });
  await db.insert(seasons).values(s);
  return s.id as string;
}

async function seedCompletedPairing(
  seasonId: string,
  weekStart: string,
  a: ProfileRow,
  b: ProfileRow,
  winnerProfileId: string | null,
): Promise<void> {
  const pairing = buildNemesisPairing(seasonId, a.id as string, b.id as string, {
    weekStart,
    status: 'completed',
    winnerProfileId,
    verdict: {
      narration: {
        [a.id as string]: { line: `${a.handle} verdict for ${weekStart}`, emphasis: null },
        [b.id as string]: { line: `${b.handle} verdict for ${weekStart}`, emphasis: null },
      },
    },
  });
  await db.insert(nemesisPairings).values(pairing);
}

async function seedCallout(challengerProfileId: string, createdAt: Date): Promise<void> {
  const c = buildCallout(challengerProfileId, { createdAt });
  await db.insert(callouts).values(c);
}

async function getArtifact(
  profileId: string,
  seasonId: string,
): Promise<CompanionArtifactRow | null> {
  const [row] = await db
    .select()
    .from(companionArtifacts)
    .where(
      sql`${companionArtifacts.profileId} = ${profileId} AND ${companionArtifacts.seasonId} = ${seasonId}`,
    )
    .limit(1);
  return row ?? null;
}

describe('runSeasonRecap — primary generation + idempotency', () => {
  it('generates a recap for each profile the fake generator succeeds for, skips the one it returns null for, and reruns make no new generator calls', async () => {
    const seasonId = await seedSeasonRow('2026-01-01', '2026-03-01');
    const a = await seedClaimedProfile('Fox #1');
    const b = await seedClaimedProfile('Otter #2');
    const c = await seedClaimedProfile('Hawk #3');
    await seedCompletedPairing(seasonId, '2026-01-05', a, b, a.id as string);
    await seedCompletedPairing(seasonId, '2026-01-12', a, c, c.id as string);

    const { client: xtrace } = makeFakeXtrace();
    const { generator, calls } = makeFakeGenerator(new Set(['Hawk #3']));

    const report = await runSeasonRecap(makeCtx(), xtrace, generator, seasonId, AT);
    expect(report).toEqual({ seasonId, generated: 2, skippedExisting: 0, skippedFailed: 1 });
    expect(calls).toHaveLength(3);

    expect(await getArtifact(a.id as string, seasonId)).not.toBeNull();
    expect(await getArtifact(b.id as string, seasonId)).not.toBeNull();
    expect(await getArtifact(c.id as string, seasonId)).toBeNull();

    const rerun = await runSeasonRecap(makeCtx(), xtrace, generator, seasonId, AT);
    expect(rerun.generated).toBe(0);
    expect(rerun.skippedExisting).toBe(2); // A and B already have artifacts
    expect(rerun.skippedFailed).toBe(1); // C is retried (never stored) — still skipped
    expect(calls).toHaveLength(4); // only C's retry — A/B never re-called the generator
  });
});

describe('per-profile stats (XH-T8 pinned formulas)', () => {
  it('buckets wins/losses/draws and computes the LONGEST consecutive-win streak (a draw breaks it)', async () => {
    const seasonId = await seedSeasonRow('2026-01-01', '2026-03-01');
    const a = await seedClaimedProfile('Fox #1');
    const b = await seedClaimedProfile('Otter #2');
    // A's chronological results: win, win, draw, win, loss — best streak is 2, not 3.
    await seedCompletedPairing(seasonId, '2026-01-05', a, b, a.id as string); // win
    await seedCompletedPairing(seasonId, '2026-01-12', a, b, a.id as string); // win
    await seedCompletedPairing(seasonId, '2026-01-19', a, b, null); // draw — breaks streak
    await seedCompletedPairing(seasonId, '2026-01-26', a, b, a.id as string); // win
    await seedCompletedPairing(seasonId, '2026-02-02', a, b, b.id as string); // loss

    const { client: xtrace } = makeFakeXtrace();
    const { generator, calls } = makeFakeGenerator();
    await runSeasonRecap(makeCtx(), xtrace, generator, seasonId, AT);

    const aCtx = calls.find((c) => c.handle === 'Fox #1')!;
    expect(aCtx.stats).toMatchObject({ pairings: 5, wins: 3, losses: 1, draws: 1, bestStreak: 2 });
    // Chronological verdict lines, one per pairing (both sides always populate narration here).
    expect(aCtx.verdictLines).toEqual([
      'Fox #1 verdict for 2026-01-05',
      'Fox #1 verdict for 2026-01-12',
      'Fox #1 verdict for 2026-01-19',
      'Fox #1 verdict for 2026-01-26',
      'Fox #1 verdict for 2026-02-02',
    ]);
  });

  it('only counts the OTHER profile in the pair as a loss/win from its own perspective', async () => {
    const seasonId = await seedSeasonRow('2026-01-01', '2026-03-01');
    const a = await seedClaimedProfile('Fox #1');
    const b = await seedClaimedProfile('Otter #2');
    await seedCompletedPairing(seasonId, '2026-01-05', a, b, a.id as string); // A wins, B loses

    const { client: xtrace } = makeFakeXtrace();
    const { generator, calls } = makeFakeGenerator();
    await runSeasonRecap(makeCtx(), xtrace, generator, seasonId, AT);

    const bCtx = calls.find((c) => c.handle === 'Otter #2')!;
    expect(bCtx.stats).toMatchObject({ pairings: 1, wins: 0, losses: 1, draws: 0, bestStreak: 0 });
  });

  it('never lets a non-completed pairing (e.g. the current, still-active week) leak into the stats', async () => {
    const seasonId = await seedSeasonRow('2026-01-01', '2026-03-01');
    const a = await seedClaimedProfile('Fox #1');
    const b = await seedClaimedProfile('Otter #2');
    await seedCompletedPairing(seasonId, '2026-01-05', a, b, a.id as string); // win — the only one that should count

    const activePairing = buildNemesisPairing(seasonId, a.id as string, b.id as string, {
      weekStart: '2026-01-12',
      status: 'active',
      winnerProfileId: null,
      verdict: null,
    });
    await db.insert(nemesisPairings).values(activePairing);

    const { client: xtrace } = makeFakeXtrace();
    const { generator, calls } = makeFakeGenerator();
    await runSeasonRecap(makeCtx(), xtrace, generator, seasonId, AT);

    const aCtx = calls.find((c) => c.handle === 'Fox #1')!;
    // If the still-active pairing leaked in, this would read pairings:2/draws:1/bestStreak
    // corrupted by an unordered null-winner row — it must read exactly the one completed win.
    expect(aCtx.stats).toMatchObject({ pairings: 1, wins: 1, losses: 0, draws: 0, bestStreak: 1 });
    expect(aCtx.verdictLines).toEqual(['Fox #1 verdict for 2026-01-05']);
  });
});

describe('callout stats — ET-day season window (XH-T8 off-by-one pin)', () => {
  it('excludes a callout the day before startsOn, includes one on startsOn itself AND one on endsOn itself (both boundary days)', async () => {
    const seasonId = await seedSeasonRow('2026-01-05', '2026-01-11');
    const a = await seedClaimedProfile('Fox #1');
    const b = await seedClaimedProfile('Otter #2');
    await seedCompletedPairing(seasonId, '2026-01-05', a, b, a.id as string);

    // ET is UTC-5 in January (EST) — 2026-01-04T23:00:00Z is still 2026-01-04 18:00 ET (the day
    // BEFORE the season), 2026-01-05T12:00:00Z is 2026-01-05 07:00 ET (the season's FIRST day —
    // pins the `>=` side of the window, not just the day-before-start exclusion), and
    // 2026-01-12T04:59:00Z is still 2026-01-11 23:59 ET (the season's LAST day).
    await seedCallout(a.id as string, new Date('2026-01-04T23:00:00Z')); // excluded (before)
    await seedCallout(a.id as string, new Date('2026-01-05T12:00:00Z')); // included (first day)
    await seedCallout(a.id as string, new Date('2026-01-12T04:59:00Z')); // included (last day)

    const { client: xtrace } = makeFakeXtrace();
    const { generator, calls } = makeFakeGenerator();
    await runSeasonRecap(makeCtx(), xtrace, generator, seasonId, AT);

    const aCtx = calls.find((c) => c.handle === 'Fox #1')!;
    expect(aCtx.stats.calloutsSent).toBe(2);
  });

  it("counts calloutsWon only when the callout's own pairing is completed with this profile as winner", async () => {
    const seasonId = await seedSeasonRow('2026-01-05', '2026-01-11');
    const a = await seedClaimedProfile('Fox #1');
    const b = await seedClaimedProfile('Otter #2');

    // Distinct week_start per pairing — (season_id, week_start, profile_a_id) is unique.
    const wonPairing = buildNemesisPairing(seasonId, a.id as string, b.id as string, {
      weekStart: '2026-01-05',
      status: 'completed',
      winnerProfileId: a.id as string,
      verdict: null,
    });
    const lostPairing = buildNemesisPairing(seasonId, a.id as string, b.id as string, {
      weekStart: '2026-01-06',
      status: 'completed',
      winnerProfileId: b.id as string,
      verdict: null,
    });
    await db.insert(nemesisPairings).values([wonPairing, lostPairing]);

    const wonCallout = buildCallout(a.id as string, {
      createdAt: new Date('2026-01-06T12:00:00Z'),
      pairingId: wonPairing.id as string,
    });
    const lostCallout = buildCallout(a.id as string, {
      createdAt: new Date('2026-01-07T12:00:00Z'),
      pairingId: lostPairing.id as string,
    });
    const noPairingCallout = buildCallout(a.id as string, {
      createdAt: new Date('2026-01-08T12:00:00Z'),
      pairingId: null,
    });
    await db.insert(callouts).values([wonCallout, lostCallout, noPairingCallout]);

    const { client: xtrace } = makeFakeXtrace();
    const { generator, calls } = makeFakeGenerator();
    await runSeasonRecap(makeCtx(), xtrace, generator, seasonId, AT);

    const aCtx = calls.find((c) => c.handle === 'Fox #1')!;
    expect(aCtx.stats.calloutsSent).toBe(3);
    expect(aCtx.stats.calloutsWon).toBe(1);
  });
});

describe('season resolution', () => {
  it('recaps an explicitly-given seasonId with no endsOn check, even if it is still running', async () => {
    // endsOn in the far future relative to AT — a running season.
    const seasonId = await seedSeasonRow('2026-07-01', '2026-09-30');
    const a = await seedClaimedProfile('Fox #1');
    const b = await seedClaimedProfile('Otter #2');
    await seedCompletedPairing(seasonId, '2026-07-06', a, b, a.id as string);

    const { client: xtrace } = makeFakeXtrace();
    const { generator } = makeFakeGenerator();
    const report = await runSeasonRecap(makeCtx(), xtrace, generator, seasonId, AT);

    expect(report.seasonId).toBe(seasonId);
    expect(report.generated).toBe(2);
  });

  it('an omitted seasonId resolves the latest ENDED nemesis season, never a still-running one', async () => {
    const endedSeasonId = await seedSeasonRow('2026-01-01', '2026-03-01'); // ended before AT
    const runningSeasonId = await seedSeasonRow('2026-07-01', '2026-09-30'); // still running at AT
    const a = await seedClaimedProfile('Fox #1');
    const b = await seedClaimedProfile('Otter #2');
    await seedCompletedPairing(endedSeasonId, '2026-01-05', a, b, a.id as string);
    await seedCompletedPairing(runningSeasonId, '2026-07-06', a, b, a.id as string);

    const { client: xtrace } = makeFakeXtrace();
    const { generator } = makeFakeGenerator();
    const report = await runSeasonRecap(makeCtx(), xtrace, generator, undefined, AT);

    expect(report.seasonId).toBe(endedSeasonId);
  });

  it('returns a zeroed report (not an error) when no season resolves at all', async () => {
    const { client: xtrace } = makeFakeXtrace();
    const { generator, calls } = makeFakeGenerator();
    const report = await runSeasonRecap(makeCtx(), xtrace, generator, undefined, AT);

    expect(report).toEqual({ seasonId: null, generated: 0, skippedExisting: 0, skippedFailed: 0 });
    expect(calls).toHaveLength(0);
  });
});

describe('eligible profiles', () => {
  it('excludes ghost/non-claimed profiles from the season pool even if they somehow appear in a pairing', async () => {
    const seasonId = await seedSeasonRow('2026-01-01', '2026-03-01');
    const a = await seedClaimedProfile('Fox #1');
    const ghost = await (async () => {
      const p = buildProfile({ kind: 'ghost', status: 'active', handle: 'Ghost #9' });
      const [row] = await db.insert(profiles).values(p).returning();
      return row!;
    })();
    await seedCompletedPairing(seasonId, '2026-01-05', a, ghost, a.id as string);

    const { client: xtrace } = makeFakeXtrace();
    const { generator, calls } = makeFakeGenerator();
    await runSeasonRecap(makeCtx(), xtrace, generator, seasonId, AT);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.handle).toBe('Fox #1');
    expect(await getArtifact(ghost.id as string, seasonId)).toBeNull();
  });
});

describe('memory scoping', () => {
  it('searches with userId scoping and the pinned query literal', async () => {
    const seasonId = await seedSeasonRow('2026-01-01', '2026-03-01');
    const a = await seedClaimedProfile('Fox #1');
    const b = await seedClaimedProfile('Otter #2');
    await seedCompletedPairing(seasonId, '2026-01-05', a, b, a.id as string);

    const { client: xtrace, searchCalls } = makeFakeXtrace();
    const { generator } = makeFakeGenerator();
    await runSeasonRecap(makeCtx(), xtrace, generator, seasonId, AT);

    expect(searchCalls).toHaveLength(2); // one per eligible profile (A, B)
    // `listClaimedProfileIdsInSeason` has no ORDER BY — find by userId rather than assume a
    // fixed index, so this test can't flake on an unrelated query-plan/row-order change.
    const aSearchCall = searchCalls.find((c) => (c as { userId?: string }).userId === a.id);
    expect(aSearchCall).toMatchObject({
      userId: a.id,
      query: 'season rivalry highlights grudges',
      include: ['episode', 'fact'],
    });
    const bSearchCall = searchCalls.find((c) => (c as { userId?: string }).userId === b.id);
    expect(bSearchCall).toMatchObject({
      userId: b.id,
      query: 'season rivalry highlights grudges',
      include: ['episode', 'fact'],
    });
  });
});
