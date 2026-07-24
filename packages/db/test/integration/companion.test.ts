/**
 * XH-T4 (docs/xtrace-hackathon-tasks.md) DB integration: the companion artifact cache,
 * ingestion idempotency, and the shared lifetime-record aggregate. Connects via
 * TEST_DATABASE_URL (dedicated per-agent DB; CI default receipts_test).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type pg from 'pg';
import { connect, type Db } from '../../src/client.js';
import {
  banterCacheKey,
  calloutDraftCacheKey,
  completedPairingIdsBetween,
  filterUningested,
  getArtifactByCacheKey,
  getXtraceGroupId,
  insertArtifactIdempotent,
  insertXtraceGroupIdIdempotent,
  latestRecapForProfile,
  lifetimeRecordBetween,
  listXtraceGroupIdsForPairings,
  markIngested,
  recapCacheKey,
} from '../../src/repositories/companion.js';
import {
  companionArtifacts,
  companionXtraceGroups,
  nemesisPairings,
  profiles,
  seasons,
} from '../../src/schema/index.js';
import {
  buildCompanionArtifact,
  buildNemesisPairing,
  buildProfile,
  buildSeason,
} from '../../src/testing/factories.js';

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
  await db.execute(
    sql`TRUNCATE companion_artifacts, companion_ingest_log, companion_xtrace_groups, nemesis_pairings, seasons, profiles RESTART IDENTITY CASCADE`,
  );
});

async function seedProfile(): Promise<string> {
  const p = buildProfile();
  await db.insert(profiles).values(p);
  return p.id as string;
}

describe('cache-key builders', () => {
  it('pins the exact separator/ordering format', () => {
    expect(banterCacheKey('pairing-1', 'profile-1', '2026-07-23')).toBe(
      'banter:pairing-1:profile-1:2026-07-23',
    );
    expect(calloutDraftCacheKey('challenger-1', 'target-1', '2026-07-23')).toBe(
      'callout_draft:challenger-1:target-1:2026-07-23',
    );
    expect(recapCacheKey('season-1', 'profile-1')).toBe('recap:season-1:profile-1');
  });
});

describe('insertArtifactIdempotent', () => {
  it('concurrent inserts with the same cache key yield one row and both calls return it', async () => {
    const profileId = await seedProfile();
    const row = buildCompanionArtifact(profileId, { cacheKey: 'concurrent-key' });

    const [a, b] = await Promise.all([
      insertArtifactIdempotent(db, row),
      insertArtifactIdempotent(db, row),
    ]);

    expect(a.id).toBe(b.id);
    const matching = await db
      .select()
      .from(companionArtifacts)
      .where(eq(companionArtifacts.cacheKey, 'concurrent-key'));
    expect(matching).toHaveLength(1);
    const stored = await getArtifactByCacheKey(db, 'concurrent-key');
    expect(stored?.id).toBe(a.id);
    expect(stored?.content).toEqual(row.content);
  });

  it('rejects a bogus profileId (FK cascade sanity)', async () => {
    const row = buildCompanionArtifact('00000000-0000-0000-0000-000000000000', {
      cacheKey: 'bogus-profile-key',
    });
    await expect(insertArtifactIdempotent(db, row)).rejects.toThrow();
  });
});

describe('getArtifactByCacheKey', () => {
  it('returns null for a miss', async () => {
    expect(await getArtifactByCacheKey(db, 'nope')).toBeNull();
  });
});

describe('latestRecapForProfile', () => {
  it('orders by seasons.ends_on, not createdAt — an older season inserted later must not win', async () => {
    const profileId = await seedProfile();

    const olderSeason = buildSeason({ startsOn: '2026-01-05', endsOn: '2026-04-01' });
    const newerSeason = buildSeason({ startsOn: '2026-04-06', endsOn: '2026-07-01' });
    await db.insert(seasons).values([olderSeason, newerSeason]);

    // Newer season's recap inserted FIRST (earlier createdAt would otherwise win if the query
    // sorted by createdAt alone).
    const newerRecap = buildCompanionArtifact(profileId, {
      kind: 'season_recap',
      cacheKey: recapCacheKey(newerSeason.id as string, profileId),
      seasonId: newerSeason.id as string,
      content: {
        recap: { title: 'Newer season', paragraphs: ['p'] },
        model: 'test',
        promptVersion: 1,
      },
    });
    await insertArtifactIdempotent(db, newerRecap);

    // Older season's recap re-generated AFTER (per the XH-T9 runbook's given-seasonId path) —
    // its row has a LATER createdAt than the newer season's recap.
    const olderRecap = buildCompanionArtifact(profileId, {
      kind: 'season_recap',
      cacheKey: recapCacheKey(olderSeason.id as string, profileId),
      seasonId: olderSeason.id as string,
      content: {
        recap: { title: 'Older season', paragraphs: ['p'] },
        model: 'test',
        promptVersion: 1,
      },
    });
    await insertArtifactIdempotent(db, olderRecap);

    const latest = await latestRecapForProfile(db, profileId);
    expect(latest?.content).toEqual(newerRecap.content);
  });

  it('a fresher banter artifact does not shadow the recap', async () => {
    const profileId = await seedProfile();
    const season = buildSeason();
    await db.insert(seasons).values(season);

    const recap = buildCompanionArtifact(profileId, {
      kind: 'season_recap',
      cacheKey: recapCacheKey(season.id as string, profileId),
      seasonId: season.id as string,
      content: {
        recap: { title: 'The recap', paragraphs: ['p'] },
        model: 'test',
        promptVersion: 1,
      },
    });
    await insertArtifactIdempotent(db, recap);
    // A banter artifact created after, unrelated to any season.
    await insertArtifactIdempotent(
      db,
      buildCompanionArtifact(profileId, { cacheKey: 'banter-key', kind: 'banter' }),
    );

    const latest = await latestRecapForProfile(db, profileId);
    expect(latest?.content).toEqual(recap.content);
  });

  it('returns null when the profile has no recap', async () => {
    const profileId = await seedProfile();
    expect(await latestRecapForProfile(db, profileId)).toBeNull();
  });
});

describe('markIngested / filterUningested', () => {
  it('markIngested twice returns the ids once', async () => {
    const entries = [
      { sourceKind: 'post' as const, sourceId: '11111111-1111-1111-1111-111111111111' },
      { sourceKind: 'post' as const, sourceId: '22222222-2222-2222-2222-222222222222' },
    ];

    const first = await markIngested(db, entries);
    expect(first.sort()).toEqual(entries.map((e) => e.sourceId).sort());

    const second = await markIngested(db, entries);
    expect(second).toEqual([]);
  });

  it('filterUningested excludes only already-marked ids for that sourceKind', async () => {
    const ingested = '33333333-3333-3333-3333-333333333333';
    const notIngested = '44444444-4444-4444-4444-444444444444';
    await markIngested(db, [{ sourceKind: 'pairing_verdict', sourceId: ingested }]);

    const result = await filterUningested(db, 'pairing_verdict', [ingested, notIngested]);
    expect(result).toEqual([notIngested]);

    // Same sourceId under a DIFFERENT sourceKind is not considered ingested (composite PK).
    const otherKind = await filterUningested(db, 'post', [ingested]);
    expect(otherKind).toEqual([ingested]);
  });

  it('returns [] for an empty input', async () => {
    expect(await markIngested(db, [])).toEqual([]);
    expect(await filterUningested(db, 'post', [])).toEqual([]);
  });
});

describe('lifetimeRecordBetween / completedPairingIdsBetween', () => {
  it('buckets wins/losses/draws oriented to the first argument, ignoring non-completed pairings', async () => {
    const a = await seedProfile();
    const b = await seedProfile();
    const season = buildSeason();
    await db.insert(seasons).values(season);

    const [lo, hi] = a < b ? [a, b] : [b, a];
    await db.insert(nemesisPairings).values([
      // `a` wins twice, `b` never wins — an asymmetric 2/0/1 split so a bug that fails to
      // orient by argument (or swaps wins/losses) can't hide behind a coincidentally-symmetric
      // record the way an even win/loss split would.
      buildNemesisPairing(season.id as string, lo, hi, {
        weekStart: '2026-01-05',
        status: 'completed',
        winnerProfileId: a,
      }),
      buildNemesisPairing(season.id as string, lo, hi, {
        weekStart: '2026-01-12',
        status: 'completed',
        winnerProfileId: a,
      }),
      buildNemesisPairing(season.id as string, lo, hi, {
        weekStart: '2026-01-19',
        status: 'completed',
        winnerProfileId: null,
      }),
      // Not completed — must be excluded from both the aggregate and the id list.
      buildNemesisPairing(season.id as string, lo, hi, {
        weekStart: '2026-01-26',
        status: 'scheduled',
        winnerProfileId: null,
      }),
    ]);

    expect(await lifetimeRecordBetween(db, a, b)).toEqual({ wins: 2, losses: 0, draws: 1 });
    // Orientation flips with argument order.
    expect(await lifetimeRecordBetween(db, b, a)).toEqual({ wins: 0, losses: 2, draws: 1 });

    const ids = await completedPairingIdsBetween(db, a, b);
    expect(ids).toHaveLength(3);
  });

  it('returns zeros / [] for a pair with no pairings', async () => {
    const a = await seedProfile();
    const b = await seedProfile();
    expect(await lifetimeRecordBetween(db, a, b)).toEqual({ wins: 0, losses: 0, draws: 0 });
    expect(await completedPairingIdsBetween(db, a, b)).toEqual([]);
  });
});

async function seedPairing(): Promise<string> {
  const a = await seedProfile();
  const b = await seedProfile();
  const season = buildSeason();
  await db.insert(seasons).values(season);
  const pairing = buildNemesisPairing(season.id as string, a, b);
  await db.insert(nemesisPairings).values(pairing);
  return pairing.id as string;
}

describe('xTrace group-id storage (XH-T10)', () => {
  describe('getXtraceGroupId / listXtraceGroupIdsForPairings', () => {
    it('returns null / excludes an unknown pairing', async () => {
      const pairingId = await seedPairing();
      expect(await getXtraceGroupId(db, pairingId)).toBeNull();
      expect(await listXtraceGroupIdsForPairings(db, [pairingId])).toEqual([]);
    });

    it('returns [] for an empty input array without querying', async () => {
      expect(await listXtraceGroupIdsForPairings(db, [])).toEqual([]);
    });

    it('a mix of known/unknown pairing ids returns only the known ones\' group ids', async () => {
      const known = await seedPairing();
      const unknown = await seedPairing();
      await insertXtraceGroupIdIdempotent(db, known, 'grp_known');

      const result = await listXtraceGroupIdsForPairings(db, [known, unknown]);
      expect(result).toEqual(['grp_known']);
    });
  });

  describe('insertXtraceGroupIdIdempotent', () => {
    it('concurrent inserts for the same pairing with DIFFERENT group ids yield one row, and both calls return that one stored value', async () => {
      const pairingId = await seedPairing();

      const [a, b] = await Promise.all([
        insertXtraceGroupIdIdempotent(db, pairingId, 'grp_from_call_a'),
        insertXtraceGroupIdIdempotent(db, pairingId, 'grp_from_call_b'),
      ]);

      // Both callers must agree on the SAME winning id — whichever insert actually landed —
      // not each see their own passed-in value. This is the race-safety property that matters:
      // if it broke, the loser would keep using its own (unpersisted, orphaned) group id for
      // the rest of its run and split the pairing's memory across two xTrace groups.
      expect(a).toBe(b);
      expect(['grp_from_call_a', 'grp_from_call_b']).toContain(a);

      const stored = await db
        .select()
        .from(companionXtraceGroups)
        .where(eq(companionXtraceGroups.pairingId, pairingId));
      expect(stored).toHaveLength(1); // exactly one row survived the race, not two
      expect(await getXtraceGroupId(db, pairingId)).toBe(a);
    });

    it('called twice sequentially with the same group id is a no-op the second time', async () => {
      const pairingId = await seedPairing();
      const first = await insertXtraceGroupIdIdempotent(db, pairingId, 'grp_stable');
      const second = await insertXtraceGroupIdIdempotent(db, pairingId, 'grp_stable');
      expect(first).toBe('grp_stable');
      expect(second).toBe('grp_stable');
    });

    it('rejects a bogus pairingId (FK cascade sanity)', async () => {
      await expect(
        insertXtraceGroupIdIdempotent(db, '00000000-0000-0000-0000-000000000000', 'grp_x'),
      ).rejects.toThrow();
    });
  });
});
