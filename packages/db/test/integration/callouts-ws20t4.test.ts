/**
 * WS20-T4 (journeys plan §5, D-J5) DB integration for the two repo reads this task adds:
 *
 *  - `listStandingGrudgePairs`: canonical `a < b` pairs with a standing 1–1+ head-to-head across
 *    `completed` weeks (each side has won at least once). Draws / one-sided records / cancelled
 *    weeks do NOT qualify. Feeds the matcher's `grudgePairs` boost via `nemesis:assign`.
 *  - `listAcceptedCalloutsForProfile`: the viewer's `accepted` call-outs, from EITHER role
 *    (challenger or accepting opponent) — powers the "locked in" card both `/rivals` screens show.
 *
 * Connects via TEST_DATABASE_URL (dedicated per-agent DB; CI default receipts_test).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type pg from 'pg';
import { connect, type Db } from '../../src/client.js';
import { listStandingGrudgePairs } from '../../src/repositories/nemesis.js';
import { listAcceptedCalloutsForProfile } from '../../src/repositories/callouts.js';
import { getOrCreateNemesisSeasonCovering } from '../../src/repositories/nemesis.js';
import { callouts, nemesisPairings, profiles } from '../../src/schema/index.js';
import { buildCallout, buildNemesisPairing, buildProfile } from '../../src/testing/factories.js';

const url =
  process.env.TEST_DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts_test';

let pool: pg.Pool;
let db: Db;

beforeAll(async () => {
  ({ pool, db } = connect({ connectionString: url }));
  await db.execute(sql`DROP SCHEMA public CASCADE`);
  await db.execute(sql`CREATE SCHEMA public`);
  await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  await migrate(db, {
    migrationsFolder: join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'drizzle'),
  });
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await db.execute(sql`TRUNCATE callouts, nemesis_pairings, seasons, profiles RESTART IDENTITY CASCADE`);
});

async function seedProfile(): Promise<string> {
  const p = buildProfile({ kind: 'claimed', status: 'active' });
  await db.insert(profiles).values(p);
  return p.id as string;
}

/** Canonical-order (a < b) completed pairing with an explicit winner. */
async function seedCompletedPairing(
  seasonId: string,
  x: string,
  y: string,
  winner: string,
  weekStart: string,
): Promise<void> {
  const [lo, hi] = x < y ? [x, y] : [y, x];
  await db.insert(nemesisPairings).values(
    buildNemesisPairing(seasonId, lo, hi, { weekStart, status: 'completed', winnerProfileId: winner }),
  );
}

describe('listStandingGrudgePairs (WS20-T4, D-J5)', () => {
  it('returns a canonical pair only when EACH side has won at least once (1–1+)', async () => {
    const a = await seedProfile();
    const b = await seedProfile();
    const { season } = await getOrCreateNemesisSeasonCovering(db, '2026-07-27');

    // One-sided (a beat b twice) — not a grudge yet.
    await seedCompletedPairing(season.id, a, b, a, '2026-07-06');
    await seedCompletedPairing(season.id, a, b, a, '2026-07-13');
    expect(await listStandingGrudgePairs(db)).toEqual([]);

    // b wins one back → standing grudge.
    await seedCompletedPairing(season.id, a, b, b, '2026-07-20');
    const grudges = await listStandingGrudgePairs(db);
    expect(grudges).toHaveLength(1);
    const [lo, hi] = a < b ? [a, b] : [b, a];
    expect(grudges[0]).toEqual([lo, hi]);
  });

  it('ignores draws (null winner) and other pairs', async () => {
    const a = await seedProfile();
    const b = await seedProfile();
    const c = await seedProfile();
    const { season } = await getOrCreateNemesisSeasonCovering(db, '2026-07-27');

    // a–b: a wins once, then a draw (null winner) — b never won, so not a grudge. Every pairing
    // sharing a profile-a needs a distinct week (partial-unique `(season, week, profile_a)`).
    await seedCompletedPairing(season.id, a, b, a, '2026-07-06');
    const [lo, hi] = a < b ? [a, b] : [b, a];
    await db.insert(nemesisPairings).values(
      buildNemesisPairing(season.id, lo, hi, {
        weekStart: '2026-07-13',
        status: 'completed',
        winnerProfileId: null,
      }),
    );
    // a–c: genuine 1–1.
    await seedCompletedPairing(season.id, a, c, a, '2026-07-20');
    await seedCompletedPairing(season.id, a, c, c, '2026-07-27');

    const grudges = await listStandingGrudgePairs(db);
    const [acLo, acHi] = a < c ? [a, c] : [c, a];
    expect(grudges).toEqual([[acLo, acHi]]);
  });
});

describe('listAcceptedCalloutsForProfile (WS20-T4, D-J5)', () => {
  it('returns accepted call-outs where the viewer is EITHER the challenger or the opponent', async () => {
    const challenger = await seedProfile();
    const opponent = await seedProfile();
    const stranger = await seedProfile();

    // Accepted call-out between challenger and opponent.
    await db.insert(callouts).values(
      buildCallout(challenger, {
        opponentProfileId: opponent,
        status: 'accepted',
        tokenHash: 'accepted-1',
      }),
    );
    // A still-pending one from the stranger — must never show as accepted.
    await db.insert(callouts).values(buildCallout(stranger, { tokenHash: 'pending-1' }));

    const forChallenger = await listAcceptedCalloutsForProfile(db, challenger);
    expect(forChallenger).toHaveLength(1);
    expect(forChallenger[0]!.opponentProfileId).toBe(opponent);

    const forOpponent = await listAcceptedCalloutsForProfile(db, opponent);
    expect(forOpponent).toHaveLength(1);
    expect(forOpponent[0]!.challengerProfileId).toBe(challenger);

    expect(await listAcceptedCalloutsForProfile(db, stranger)).toHaveLength(0);
  });
});
