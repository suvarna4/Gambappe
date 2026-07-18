/**
 * `fingerprint:nightly` (WS4-T7, §7.6 daily 03:00 ET; §8.1): rebuilds every profile's
 * `fingerprints` row from its graded, non-void pick history using the WS4-T1 pure
 * `computeFingerprint` function, then derives `ratings.accuracy_percentile` (§8.3 — "nightly,
 * rank of lifetime accuracy among profiles with >= ACCURACY_PERCENTILE_MIN_PICKS graded picks;
 * display-only") from the same pass. WS3-T5 (percentiles) is a DIFFERENT, per-question,
 * edge-based statistic (`GET /questions/*` reveal payload); this is a lifetime, accuracy-based
 * ranking that lives on `ratings` per §5.4 — no overlap/duplication with that task.
 *
 * SPEC-GAP(ws4-t7): §8.1 doesn't say incremental vs. full nightly rebuild; this is a FULL
 * recompute over every profile with >=1 graded pick each run (see the longer note on
 * `listProfileIdsWithGradedPicks`) — the safe, simplest-to-reason-about default per §0.2.
 *
 * SPEC-GAP(ws4-t7): §8.1's "graded, non-void picks" isn't explicitly scoped to `revealed`
 * daily questions the way §8.12's leaderboard formula is ("only revealed questions count,
 * §6.5 publication rule"). This job follows §6.5's own established precedent instead
 * (`grade:followup` computes WS3-T5 percentiles at GRADE time, before reveal, and lets the
 * reveal-payload/API layer be the thing that withholds pre-reveal results) — fingerprints are
 * computed over every graded pick regardless of reveal status, and any pre-reveal-leak masking
 * for fingerprint-derived UI is left to whichever task renders it (profile page, WS7-T4).
 */
import {
  ACCURACY_PERCENTILE_MIN_PICKS,
  computePercentiles,
  now,
  type FingerprintPrior,
} from '@receipts/core';
import { computeFingerprint, type GradedPickInput } from '@receipts/engine';
import {
  clearAccuracyPercentileFor,
  getFingerprintPriorsForProfiles,
  getGradedPicksForFingerprint,
  listProfileIdsWithGradedPicks,
  upsertAccuracyPercentile,
  upsertFingerprintNightly,
  type Db,
  type GradedPickForFingerprint,
} from '@receipts/db';
import type { JobHandler } from '../heartbeat.js';
import { logger } from '../logger.js';

function toGradedPickInput(row: GradedPickForFingerprint): GradedPickInput {
  return {
    side: row.side,
    yesPriceAtEntry: row.yesPriceAtEntry,
    won: row.won,
    category: row.category,
    pickedAt: row.pickedAt,
    questionOpenAt: row.questionOpenAt,
    questionLockAt: row.questionLockAt,
    lockCrowd: { yes: row.crowdYesAtLock, no: row.crowdNoAtLock },
  };
}

export interface FingerprintNightlyReport {
  profilesRebuilt: number;
  failures: number;
  percentilesWritten: number;
  percentilesCleared: number;
}

export async function runFingerprintNightly(db: Db, at: Date = now()): Promise<FingerprintNightlyReport> {
  const profileIds = await listProfileIdsWithGradedPicks(db);
  const report: FingerprintNightlyReport = {
    profilesRebuilt: 0,
    failures: 0,
    percentilesWritten: 0,
    percentilesCleared: 0,
  };
  if (profileIds.length === 0) return report;

  const [allPicks, priors] = await Promise.all([
    getGradedPicksForFingerprint(db, profileIds),
    getFingerprintPriorsForProfiles(db, profileIds),
  ]);

  const picksByProfile = new Map<string, GradedPickInput[]>();
  for (const pick of allPicks) {
    const list = picksByProfile.get(pick.profileId);
    if (list) list.push(toGradedPickInput(pick));
    else picksByProfile.set(pick.profileId, [toGradedPickInput(pick)]);
  }

  // §8.3 accuracy_percentile: gathered across this same pass, ranked once, written after.
  const eligibleForPercentile: { profileId: string; accuracy: number }[] = [];
  const ineligibleForPercentile: string[] = [];

  for (const profileId of profileIds) {
    const picks = picksByProfile.get(profileId) ?? [];
    const prior: FingerprintPrior | null | undefined = priors.get(profileId);
    try {
      const vector = computeFingerprint(picks, prior, at);
      await upsertFingerprintNightly(
        db,
        profileId,
        {
          resolvedPickCount: vector.resolvedPickCount,
          brier: vector.brier,
          accuracy: vector.accuracy,
          edgeMean: vector.edgeMean,
          chalk: vector.chalk,
          contrarian: vector.contrarian,
          timing: vector.timing,
          categoryShares: vector.categoryShares,
          categoryAccuracy: vector.categoryAccuracy,
          placementPrior: vector.placementPrior,
        },
        at,
      );
      report.profilesRebuilt += 1;

      if (vector.resolvedPickCount >= ACCURACY_PERCENTILE_MIN_PICKS && vector.accuracy !== null) {
        eligibleForPercentile.push({ profileId, accuracy: vector.accuracy });
      } else {
        ineligibleForPercentile.push(profileId);
      }
    } catch (err) {
      report.failures += 1;
      logger.error({ err, profileId }, 'fingerprint:nightly failed for profile');
    }
  }

  if (eligibleForPercentile.length > 0) {
    const percentiles = computePercentiles(eligibleForPercentile.map((e) => e.accuracy));
    for (let i = 0; i < eligibleForPercentile.length; i++) {
      const { profileId } = eligibleForPercentile[i]!;
      try {
        await upsertAccuracyPercentile(db, profileId, percentiles[i]!, at);
        report.percentilesWritten += 1;
      } catch (err) {
        logger.error({ err, profileId }, 'fingerprint:nightly accuracy_percentile write failed');
      }
    }
  }

  if (ineligibleForPercentile.length > 0) {
    await clearAccuracyPercentileFor(db, ineligibleForPercentile);
    report.percentilesCleared = ineligibleForPercentile.length;
  }

  return report;
}

export const fingerprintNightlyHandler: JobHandler = async (ctx) => {
  const report = await runFingerprintNightly(ctx.db);
  logger.info({ report }, 'fingerprint:nightly complete');
};
