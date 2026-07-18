/**
 * WS4-T8 integration: the placement DB-backed pieces (`apps/web/lib/placement-service.ts`)
 * against a real Postgres — mirrors `apps/web/test/integration/claim-flow.test.ts`'s harness.
 * Requires a live Postgres (docker-compose / CI service); not runnable in this sandbox.
 *
 * Covers:
 *  - `seedPlacementPrior` writes the §8.1-golden prior onto a fresh `fingerprints` row.
 *  - Re-answering recomputes the prior from ALL answers so far, without touching any other
 *    fingerprint column that a (simulated) nightly rebuild already wrote.
 *  - Placement answers never touch `picks` — the table `GET /me`'s eligibility block reads from
 *    (§9.2) — proving they can't contaminate the 5/10 mode-eligibility thresholds.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type pg from 'pg';
import {
  connect,
  fingerprints,
  placementItems,
  profiles,
  type Db,
} from '@receipts/db';
import { buildPlacementItem, buildProfile } from '@receipts/db/testing';
import {
  getActivePlacementItems,
  seedPlacementPrior,
  upsertPlacementAnswer,
} from '@/lib/placement-service';

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
    migrationsFolder: join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'packages', 'db', 'drizzle'),
  });
});

afterAll(async () => {
  await pool.end();
});

async function makeProfile(): Promise<string> {
  const profile = buildProfile();
  await db.insert(profiles).values(profile);
  return profile.id as string;
}

/** The exact §8.1-golden 5-answer set from `apps/web/test/placement-service.test.ts`. */
async function seedGoldenItemsAndAnswers(profileId: string): Promise<void> {
  const specs = [
    { side: 'yes' as const, historicalYesPrice: 0.7, historicalCrowdYesPct: 65 },
    { side: 'no' as const, historicalYesPrice: 0.3, historicalCrowdYesPct: 30 },
    { side: 'yes' as const, historicalYesPrice: 0.2, historicalCrowdYesPct: 15 },
    { side: 'yes' as const, historicalYesPrice: 0.9, historicalCrowdYesPct: 88 },
    { side: 'no' as const, historicalYesPrice: 0.5, historicalCrowdYesPct: 50 },
  ];
  for (const spec of specs) {
    const item = buildPlacementItem({
      historicalYesPrice: spec.historicalYesPrice,
      historicalCrowdYesPct: spec.historicalCrowdYesPct,
      outcome: spec.side, // arbitrary — outcome doesn't feed the prior formula
    });
    await db.insert(placementItems).values(item);
    await upsertPlacementAnswer(db, profileId, item.id as string, spec.side, new Date('2026-01-01T00:00:00Z'));
  }
}

describe('seedPlacementPrior (§8.7, §8.1 golden)', () => {
  it('creates a fingerprints row with the golden chalk/contrarian and resolvedPickCount 0', async () => {
    const profileId = await makeProfile();
    await seedGoldenItemsAndAnswers(profileId);

    await seedPlacementPrior(db, profileId, new Date('2026-01-01T00:00:00Z'));

    const [row] = await db.select().from(fingerprints).where(eq(fingerprints.profileId, profileId));
    expect(row).toBeTruthy();
    expect(row!.resolvedPickCount).toBe(0);
    const prior = row!.placementPrior as { chalk: number; contrarian: number };
    expect(prior.chalk).toBeCloseTo(0.2, 10);
    expect(prior.contrarian).toBeCloseTo(-0.6, 10);
    expect(prior).not.toHaveProperty('timing'); // placement never seeds timing (§8.7)
  });

  it('recomputes from ALL answers so far and never touches other fingerprint columns', async () => {
    const profileId = await makeProfile();

    // Simulate a prior nightly rebuild (WS4-T7) having already written real fingerprint data.
    await db.insert(fingerprints).values({
      profileId,
      resolvedPickCount: 42,
      accuracy: 0.6,
      brier: 0.3,
      edgeMean: 0.05,
      chalk: 0.1,
      contrarian: 0.1,
      timing: 0.1,
      computedAt: new Date('2025-12-01T00:00:00Z'),
    });

    // One favorite pick → chalk should move sharply positive; contrarian 0 (no minority picks).
    const item = buildPlacementItem({ historicalYesPrice: 0.9, historicalCrowdYesPct: 90 });
    await db.insert(placementItems).values(item);
    await upsertPlacementAnswer(db, profileId, item.id as string, 'yes', new Date('2026-01-02T00:00:00Z'));
    await seedPlacementPrior(db, profileId, new Date('2026-01-02T00:00:00Z'));

    const [row] = await db.select().from(fingerprints).where(eq(fingerprints.profileId, profileId));
    const prior = row!.placementPrior as { chalk: number; contrarian: number };
    expect(prior.chalk).toBeCloseTo(0.8, 10); // 2*0.9 - 1
    expect(prior.contrarian).toBe(-1); // 2*(0/1) - 1

    // Nightly-rebuild columns are untouched — only placement_prior changed. (`real` columns are
    // float4 in Postgres, so compare with reduced precision to avoid float4-rounding flakiness.)
    expect(row!.resolvedPickCount).toBe(42);
    expect(row!.accuracy).toBeCloseTo(0.6, 5);
    expect(row!.chalk).toBeCloseTo(0.1, 5);
    expect(row!.contrarian).toBeCloseTo(0.1, 5);
    expect(row!.timing).toBeCloseTo(0.1, 5);
  });

  it('re-answering the same item is idempotent-by-replacement (last answer wins)', async () => {
    const profileId = await makeProfile();
    const item = buildPlacementItem({ historicalYesPrice: 0.9, historicalCrowdYesPct: 90 });
    await db.insert(placementItems).values(item);

    await upsertPlacementAnswer(db, profileId, item.id as string, 'yes', new Date('2026-01-01T00:00:00Z'));
    await upsertPlacementAnswer(db, profileId, item.id as string, 'no', new Date('2026-01-01T00:01:00Z'));

    const rows = await db.select().from(profiles).where(eq(profiles.id, profileId)); // sanity: profile still exists
    expect(rows).toHaveLength(1);

    await seedPlacementPrior(db, profileId, new Date('2026-01-01T00:02:00Z'));
    const [fp] = await db.select().from(fingerprints).where(eq(fingerprints.profileId, profileId));
    const prior = fp!.placementPrior as { chalk: number; contrarian: number };
    // Only one answer row should exist for this (profile, item) pair — 'no' @ p=1-0.9=0.1.
    expect(prior.chalk).toBeCloseTo(2 * 0.1 - 1, 10);
  });
});

describe('placement answers never contaminate GET /me eligibility (§9.2, §8.7)', () => {
  it('inserting placement answers leaves the picks table (eligibility source) untouched', async () => {
    const profileId = await makeProfile();
    await seedGoldenItemsAndAnswers(profileId); // 5 placement_answers rows
    await seedPlacementPrior(db, profileId, new Date('2026-01-01T00:00:00Z'));

    const pickCountResult = await db.execute(sql`
      select count(*)::int as n from picks where profile_id = ${profileId} and result in ('win', 'loss')
    `);
    // This is exactly what GET /me's eligibility.graded_picks reads from (§9.2) — proving
    // placement never writes to `picks` means it structurally cannot move that count.
    expect(Number(pickCountResult.rows[0]?.['n'])).toBe(0);

    const answerCountResult = await db.execute(sql`
      select count(*)::int as n from placement_answers where profile_id = ${profileId}
    `);
    expect(Number(answerCountResult.rows[0]?.['n'])).toBe(5);
  });
});

describe('getActivePlacementItems (§8.7)', () => {
  it('excludes inactive items', async () => {
    const active = buildPlacementItem({ active: true, title: 'active item for filter test' });
    const inactive = buildPlacementItem({ active: false, title: 'inactive item for filter test' });
    await db.insert(placementItems).values([active, inactive]);

    const items = await getActivePlacementItems(db);
    const ids = new Set(items.map((i) => i.id));
    expect(ids.has(active.id as string)).toBe(true);
    expect(ids.has(inactive.id as string)).toBe(false);
  });
});
