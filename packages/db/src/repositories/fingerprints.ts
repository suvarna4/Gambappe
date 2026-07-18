/**
 * `fingerprints` repository. Historically just the placement/wallet-prior seeding slice
 * (§8.7, §12.4) — WS4-T7 adds the nightly-rebuild write path below (`listProfileIdsWithGradedPicks`,
 * `getGradedPicksForFingerprint`, `upsertFingerprintNightly`). This package has no dependency
 * on `@receipts/engine` (§4.2: only `apps/*` may depend on both), so the pick rows this returns
 * are plain DB shapes — `apps/worker`'s job maps them onto `@receipts/engine`'s
 * `GradedPickInput` before calling `computeFingerprint`.
 */
import { eq, sql } from 'drizzle-orm';
import type { FingerprintPrior, MarketCategory, MarketSide } from '@receipts/core';
import type { Db } from '../client.js';
import { fingerprints } from '../schema/index.js';

export type FingerprintRow = typeof fingerprints.$inferSelect;

export async function getFingerprintRow(db: Db, profileId: string): Promise<FingerprintRow | null> {
  const [row] = await db
    .select()
    .from(fingerprints)
    .where(eq(fingerprints.profileId, profileId))
    .limit(1);
  return row ?? null;
}

/**
 * Upserts ONLY `placement_prior` (§8.7/§12.4 seeding path). A fresh row (no fingerprint yet —
 * the nightly rebuild, WS4-T7, hasn't run for this profile) is inserted with neutral defaults
 * (`resolved_pick_count=0`, everything else null/empty) and `computed_at = at`. An EXISTING
 * row's `placement_prior` is patched in place WITHOUT touching `computed_at` or any of the
 * nightly-computed metrics — those belong solely to `fingerprint:nightly` (WS4-T7).
 */
export async function upsertFingerprintPrior(
  db: Db,
  profileId: string,
  prior: FingerprintPrior | null,
  at: Date,
): Promise<FingerprintRow> {
  const [row] = await db
    .insert(fingerprints)
    .values({
      profileId,
      resolvedPickCount: 0,
      placementPrior: prior,
      computedAt: at,
    })
    .onConflictDoUpdate({
      target: fingerprints.profileId,
      set: { placementPrior: prior },
    })
    .returning();
  if (!row) throw new Error(`upsertFingerprintPrior: no row returned for profileId=${profileId}`);
  return row;
}

/**
 * §8.1 nightly rebuild population: profiles with ≥1 graded, non-void pick (`result IN
 * ('win','loss')`), excluding `status='deleted'` — a deleted profile's `fingerprints` row is
 * hard-deleted at deletion (§11.4) and must never be resurrected by a later nightly run.
 * SPEC-GAP(ws4-t7): §8.1 doesn't say whether the nightly rebuild is incremental (only profiles
 * with a NEW graded pick since their last computation) or a full recompute over every eligible
 * profile; per §0.2 ("implement the smallest behavior consistent with the invariants"), this
 * is a full recompute over all eligible profiles every night — simplest to reason about and
 * idempotent by construction (§19.4 rule 4), at the cost of recomputing profiles whose graded
 * pick history didn't change since yesterday.
 */
export async function listProfileIdsWithGradedPicks(db: Db): Promise<string[]> {
  const rows = await db.execute(sql`
    SELECT DISTINCT p.profile_id
    FROM picks p
    JOIN profiles pr ON pr.id = p.profile_id
    WHERE p.result IN ('win', 'loss') AND pr.status != 'deleted'
  `);
  return rows.rows.map((r) => r['profile_id'] as string);
}

/** One graded, non-void pick shaped for `@receipts/engine`'s `computeFingerprint` (§8.1) —
 * plain DB row, no engine-type dependency (see file header). */
export interface GradedPickForFingerprint {
  profileId: string;
  side: MarketSide;
  yesPriceAtEntry: number;
  won: boolean;
  category: MarketCategory;
  pickedAt: Date;
  questionOpenAt: Date;
  questionLockAt: Date;
  /** Crowd-at-lock snapshot; 0/0 when the question never recorded one (below CROWD_MIN_N in
   * effect — §8.1 contrarian metric only counts crowdN ≥ CROWD_MIN_N anyway). */
  crowdYesAtLock: number;
  crowdNoAtLock: number;
}

/**
 * Bulk fetch of every graded, non-void pick for the given profiles, joined to its question's
 * open/lock timestamps + crowd-at-lock snapshot and its market's category — everything §8.1's
 * formulas need. One query for the whole nightly population rather than one per profile.
 */
export async function getGradedPicksForFingerprint(
  db: Db,
  profileIds: readonly string[],
): Promise<GradedPickForFingerprint[]> {
  if (profileIds.length === 0) return [];
  const idArray = `{${profileIds.join(',')}}`;
  const rows = await db.execute(sql`
    SELECT p.profile_id, p.side, p.yes_price_at_entry, p.result, m.category, p.picked_at,
           q.open_at, q.lock_at, q.crowd_yes_at_lock, q.crowd_no_at_lock
    FROM picks p
    JOIN questions q ON q.id = p.question_id
    JOIN markets m ON m.id = q.market_id
    WHERE p.result IN ('win', 'loss') AND p.profile_id = ANY(${idArray}::uuid[])
  `);
  return rows.rows.map((r) => ({
    profileId: r['profile_id'] as string,
    side: r['side'] as MarketSide,
    yesPriceAtEntry: Number(r['yes_price_at_entry']),
    won: r['result'] === 'win',
    category: r['category'] as MarketCategory,
    pickedAt: new Date(r['picked_at'] as string),
    questionOpenAt: new Date(r['open_at'] as string),
    questionLockAt: new Date(r['lock_at'] as string),
    crowdYesAtLock: r['crowd_yes_at_lock'] === null ? 0 : Number(r['crowd_yes_at_lock']),
    crowdNoAtLock: r['crowd_no_at_lock'] === null ? 0 : Number(r['crowd_no_at_lock']),
  }));
}

/** Existing `placement_prior` per profile (bulk), for feeding back into `computeFingerprint`'s
 * prior-blend so the nightly rebuild never drops a placement/wallet-seeded prior (§8.1/§8.7). */
export async function getFingerprintPriorsForProfiles(
  db: Db,
  profileIds: readonly string[],
): Promise<Map<string, FingerprintPrior | null>> {
  const map = new Map<string, FingerprintPrior | null>();
  if (profileIds.length === 0) return map;
  const idArray = `{${profileIds.join(',')}}`;
  const rows = await db.execute(sql`
    SELECT profile_id, placement_prior FROM fingerprints WHERE profile_id = ANY(${idArray}::uuid[])
  `);
  for (const r of rows.rows) {
    map.set(r['profile_id'] as string, (r['placement_prior'] as FingerprintPrior | null) ?? null);
  }
  return map;
}

/** The nightly-computed fields (design doc §5.4/§8.1) — everything BUT the PK and
 * `calibration` (always null until `confidence_slider` ships, §8.1). */
export interface FingerprintNightlyWrite {
  resolvedPickCount: number;
  brier: number | null;
  accuracy: number | null;
  edgeMean: number | null;
  chalk: number;
  contrarian: number;
  timing: number;
  categoryShares: Partial<Record<MarketCategory, number>>;
  categoryAccuracy: Partial<Record<MarketCategory, number>>;
  placementPrior: FingerprintPrior | null;
}

/**
 * Full nightly upsert (§8.1 `fingerprint:nightly`, WS4-T7) — writes every nightly-computed
 * column, unlike `upsertFingerprintPrior` which only ever touches `placement_prior`.
 * `vector.placementPrior` should be exactly what was read for this profile via
 * `getFingerprintPriorsForProfiles` (round-tripped through `computeFingerprint`, which echoes
 * its `prior` argument back on the result) — this write never drops an existing prior.
 */
export async function upsertFingerprintNightly(
  db: Db,
  profileId: string,
  vector: FingerprintNightlyWrite,
  at: Date,
): Promise<void> {
  const values = {
    resolvedPickCount: vector.resolvedPickCount,
    brier: vector.brier,
    accuracy: vector.accuracy,
    edgeMean: vector.edgeMean,
    chalk: vector.chalk,
    contrarian: vector.contrarian,
    timing: vector.timing,
    categoryShares: vector.categoryShares,
    categoryAccuracy: vector.categoryAccuracy,
    calibration: null,
    placementPrior: vector.placementPrior,
    computedAt: at,
  };
  await db
    .insert(fingerprints)
    .values({ profileId, ...values })
    .onConflictDoUpdate({ target: fingerprints.profileId, set: values });
}
