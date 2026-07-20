/**
 * SW10-T4 (wiring-gaps doc §4) integration: `submitPairingReaction` (write path,
 * `lib/nemesis/reactions.ts`) and `getPairingPublicById`/`buildPairingPublic`'s
 * `today_reactions` (read path, `lib/nemesis/service.ts`) against real Postgres. Mirrors
 * `nemesis-matchup-api.test.ts`'s own header note: route auth (Auth.js session resolution)
 * isn't mocked anywhere in this repo's `lib/`-level tests, so this exercises `lib/` functions
 * directly — the route's own thin parse-then-delegate wiring (plus the ghost-rejection case,
 * which specifically needs to be proven against the real route handler per this task's AC) is
 * covered separately in `pairing-reactions-route.test.ts`.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type pg from 'pg';
import {
  connect,
  getPairingById,
  getTodayPairingReactions,
  nemesisPairings,
  profiles,
  seasons,
  type Db,
  type ProfileRow,
} from '@receipts/db';
import { buildNemesisPairing, buildProfile, buildSeason } from '@receipts/db/testing';
import { applyBlock } from '@/lib/moderation';
import { submitPairingReaction } from '@/lib/nemesis/reactions';
import { getPairingPublicById } from '@/lib/nemesis/service';

const dbUrl = process.env.TEST_DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts_test';

const NOW = new Date('2026-07-20T18:00:00Z'); // an ET afternoon — etDateString(NOW) === '2026-07-20'
const NEXT_DAY = new Date('2026-07-21T18:00:00Z');
const WEEK_START = '2026-07-13';

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
    sql`TRUNCATE TABLE pairing_reactions, blocks, notifications, rematch_requests, duo_matches, duos, pairing_questions, nemesis_pairings, ratings, picks, questions, markets, profiles, users, seasons RESTART IDENTITY CASCADE`,
  );
});

async function makeProfile(overrides: Partial<ProfileRow> = {}): Promise<ProfileRow> {
  const [row] = await db.insert(profiles).values(buildProfile({ status: 'active', ...overrides })).returning();
  return row!;
}

async function makeSeasonRow(): Promise<string> {
  const [row] = await db.insert(seasons).values(buildSeason({ startsOn: '2026-07-06', endsOn: '2026-09-28' })).returning();
  return row!.id;
}

async function makePairing(seasonId: string, a: string, b: string): Promise<string> {
  const [row] = await db
    .insert(nemesisPairings)
    .values(buildNemesisPairing(seasonId, a, b, { weekStart: WEEK_START, status: 'active' }))
    .returning();
  return row!.id;
}

describe('submitPairingReaction (§4 SW10-T4 write path)', () => {
  it('rejects a ghost profile (server-side — not merely a client-side claim-prompt gate)', async () => {
    const seasonId = await makeSeasonRow();
    const [a, b] = await Promise.all([makeProfile({ kind: 'claimed' }), makeProfile({ kind: 'claimed' })]);
    const pairingId = await makePairing(seasonId, a.id, b.id);
    const ghost = await makeProfile({ kind: 'ghost' });

    await expect(
      submitPairingReaction(db, { pairingId, profileId: ghost.id, profileKind: 'ghost', emoji: 'Lucky' }, NOW),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    // And nothing was written.
    const rows = await getTodayPairingReactions(db, pairingId, '2026-07-20');
    expect(rows).toEqual([]);
  });

  it('rejects a claimed profile who is not one of the pairing\'s own two participants', async () => {
    const seasonId = await makeSeasonRow();
    const [a, b] = await Promise.all([makeProfile({ kind: 'claimed' }), makeProfile({ kind: 'claimed' })]);
    const pairingId = await makePairing(seasonId, a.id, b.id);
    const stranger = await makeProfile({ kind: 'claimed' });

    await expect(
      submitPairingReaction(db, { pairingId, profileId: stranger.id, profileKind: 'claimed', emoji: 'Lucky' }, NOW),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects an unknown pairing id (NOT_FOUND)', async () => {
    const someone = await makeProfile({ kind: 'claimed' });
    await expect(
      submitPairingReaction(
        db,
        { pairingId: '018f0000-0000-7000-8000-000000000000', profileId: someone.id, profileKind: 'claimed', emoji: 'Lucky' },
        NOW,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects reactions between a blocked pair (§14.3 block severance, both directions)', async () => {
    const seasonId = await makeSeasonRow();
    const [a, b] = await Promise.all([makeProfile({ kind: 'claimed' }), makeProfile({ kind: 'claimed' })]);
    const pairingId = await makePairing(seasonId, a.id, b.id);
    await applyBlock(db, a.id, b.id, NOW); // a blocks b

    await expect(
      submitPairingReaction(db, { pairingId, profileId: a.id, profileKind: 'claimed', emoji: 'Lucky' }, NOW),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // The severance is symmetric — b (the blocked party) is equally rejected.
    await expect(
      submitPairingReaction(db, { pairingId, profileId: b.id, profileKind: 'claimed', emoji: 'Lucky' }, NOW),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('first post of the day adds; a same-day repost REPLACES rather than toggling off or 409ing', async () => {
    const seasonId = await makeSeasonRow();
    const [a, b] = await Promise.all([makeProfile({ kind: 'claimed' }), makeProfile({ kind: 'claimed' })]);
    const pairingId = await makePairing(seasonId, a.id, b.id);

    const first = await submitPairingReaction(db, { pairingId, profileId: a.id, profileKind: 'claimed', emoji: 'Sweating?' }, NOW);
    expect(first).toBe('added');

    // A DIFFERENT stamp, same day — replaces, doesn't toggle off, doesn't throw a 409.
    const second = await submitPairingReaction(db, { pairingId, profileId: a.id, profileKind: 'claimed', emoji: 'Lucky' }, NOW);
    expect(second).toBe('replaced');

    // The IDENTICAL stamp again, same day — still replaces (not a toggle-off, unlike the
    // generic question/duo_match reactions path).
    const third = await submitPairingReaction(db, { pairingId, profileId: a.id, profileKind: 'claimed', emoji: 'Lucky' }, NOW);
    expect(third).toBe('replaced');

    const rows = await getTodayPairingReactions(db, pairingId, '2026-07-20');
    expect(rows).toEqual([{ profileId: a.id, emoji: 'Lucky' }]);
  });

  it('the next ET calendar day is a fresh slot — "added", not "replaced"', async () => {
    const seasonId = await makeSeasonRow();
    const [a, b] = await Promise.all([makeProfile({ kind: 'claimed' }), makeProfile({ kind: 'claimed' })]);
    const pairingId = await makePairing(seasonId, a.id, b.id);

    await submitPairingReaction(db, { pairingId, profileId: a.id, profileKind: 'claimed', emoji: 'Respect' }, NOW);
    const nextDay = await submitPairingReaction(
      db,
      { pairingId, profileId: a.id, profileKind: 'claimed', emoji: 'Respect' },
      NEXT_DAY,
    );
    expect(nextDay).toBe('added');

    // Both days' rows independently exist (the unique index is per-day, not lifetime-per-player).
    const day1 = await getTodayPairingReactions(db, pairingId, '2026-07-20');
    const day2 = await getTodayPairingReactions(db, pairingId, '2026-07-21');
    expect(day1).toEqual([{ profileId: a.id, emoji: 'Respect' }]);
    expect(day2).toEqual([{ profileId: a.id, emoji: 'Respect' }]);
  });

  it('each player has their own independent one-per-day slot on the same pairing', async () => {
    const seasonId = await makeSeasonRow();
    const [a, b] = await Promise.all([makeProfile({ kind: 'claimed' }), makeProfile({ kind: 'claimed' })]);
    const pairingId = await makePairing(seasonId, a.id, b.id);

    await submitPairingReaction(db, { pairingId, profileId: a.id, profileKind: 'claimed', emoji: 'Called it' }, NOW);
    await submitPairingReaction(db, { pairingId, profileId: b.id, profileKind: 'claimed', emoji: 'Respect' }, NOW);

    const rows = await getTodayPairingReactions(db, pairingId, '2026-07-20');
    expect(new Set(rows.map((r) => `${r.profileId}:${r.emoji}`))).toEqual(
      new Set([`${a.id}:Called it`, `${b.id}:Respect`]),
    );
  });

  it('the pairing_reactions row is real (getPairingById still resolves the pairing untouched)', async () => {
    const seasonId = await makeSeasonRow();
    const [a, b] = await Promise.all([makeProfile({ kind: 'claimed' }), makeProfile({ kind: 'claimed' })]);
    const pairingId = await makePairing(seasonId, a.id, b.id);
    await submitPairingReaction(db, { pairingId, profileId: a.id, profileKind: 'claimed', emoji: 'Lucky' }, NOW);
    await expect(getPairingById(db, pairingId)).resolves.not.toBeNull();
  });
});

describe('getPairingPublicById today_reactions (§4 SW10-T4 read path)', () => {
  it('is {a: null, b: null} when neither player has reacted today', async () => {
    const seasonId = await makeSeasonRow();
    const [a, b] = await Promise.all([makeProfile({ kind: 'claimed' }), makeProfile({ kind: 'claimed' })]);
    const pairingId = await makePairing(seasonId, a.id, b.id);

    const pairing = await getPairingPublicById(db, pairingId, NOW);
    expect(pairing!.today_reactions).toEqual({ a: null, b: null });
  });

  it("reflects each side's own today-stamp, keyed to the pairing's a/b, not post order", async () => {
    const seasonId = await makeSeasonRow();
    const [a, b] = await Promise.all([makeProfile({ kind: 'claimed' }), makeProfile({ kind: 'claimed' })]);
    const pairingId = await makePairing(seasonId, a.id, b.id);

    await submitPairingReaction(db, { pairingId, profileId: b.id, profileKind: 'claimed', emoji: 'Respect' }, NOW);
    await submitPairingReaction(db, { pairingId, profileId: a.id, profileKind: 'claimed', emoji: 'Sweating?' }, NOW);

    const pairing = await getPairingPublicById(db, pairingId, NOW);
    expect(pairing!.today_reactions).toEqual({ a: 'Sweating?', b: 'Respect' });
  });

  it("a blocked pair's reactions round-trip in NEITHER direction on the read side (§14.3, not just write rejection)", async () => {
    const seasonId = await makeSeasonRow();
    const [a, b] = await Promise.all([makeProfile({ kind: 'claimed' }), makeProfile({ kind: 'claimed' })]);
    const pairingId = await makePairing(seasonId, a.id, b.id);

    // Reactions posted BEFORE the block existed — proves the read masks them retroactively too,
    // not merely refusing new writes going forward.
    await submitPairingReaction(db, { pairingId, profileId: a.id, profileKind: 'claimed', emoji: 'Lucky' }, NOW);
    await submitPairingReaction(db, { pairingId, profileId: b.id, profileKind: 'claimed', emoji: 'Called it' }, NOW);

    let pairing = await getPairingPublicById(db, pairingId, NOW);
    expect(pairing!.today_reactions).toEqual({ a: 'Lucky', b: 'Called it' });

    await applyBlock(db, b.id, a.id, NOW); // b blocks a

    pairing = await getPairingPublicById(db, pairingId, NOW);
    expect(pairing!.today_reactions).toEqual({ a: null, b: null });
  });

  it('the viewer\'s own stamp round-trips: post -> re-fetch -> the payload reflects it', async () => {
    const seasonId = await makeSeasonRow();
    const [a, b] = await Promise.all([makeProfile({ kind: 'claimed' }), makeProfile({ kind: 'claimed' })]);
    const pairingId = await makePairing(seasonId, a.id, b.id);

    await submitPairingReaction(db, { pairingId, profileId: a.id, profileKind: 'claimed', emoji: 'Called it' }, NOW);
    const pairing = await getPairingPublicById(db, pairingId, NOW);
    // This is the data `ReactionStampsPanel` matches its own profile id against
    // (`sideProfileIds.a === pairing.a.profile_id`) to derive `selected` client-side.
    expect(pairing!.a.profile_id).toBe(a.id);
    expect(pairing!.today_reactions!.a).toBe('Called it');

    // A same-day change round-trips too.
    await submitPairingReaction(db, { pairingId, profileId: a.id, profileKind: 'claimed', emoji: 'Respect' }, NOW);
    const reloaded = await getPairingPublicById(db, pairingId, NOW);
    expect(reloaded!.today_reactions!.a).toBe('Respect');
  });
});
