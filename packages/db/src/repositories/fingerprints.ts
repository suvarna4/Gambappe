/**
 * `fingerprints` repository — narrow slice needed outside the nightly rebuild job (WS4-T7,
 * not this workstream's scope): reading/seeding `placement_prior` only (§8.7, §12.4). The
 * full nightly-rebuild write path (accuracy/edge/chalk/etc.) belongs to WS4-T7.
 */
import { eq } from 'drizzle-orm';
import type { FingerprintPrior } from '@receipts/core';
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
