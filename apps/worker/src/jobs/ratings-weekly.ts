/**
 * `ratings:weekly` (WS4-T7, §7.6 Sun 23:00 ET; §8.3): applies the WS4-T2 pure Glicko-2 function
 * to every `nemesis_pairings` row and `duo_matches` row completed-but-unapplied this rating
 * period (`status='completed' AND rating_applied_at IS NULL` — the idempotency guard), then
 * runs the "no game this period" RD-only inflation step for already-rated profiles/duos that
 * got no game applied this run.
 *
 * Per-item processing is one transaction per pairing/match/inflation-target — rating writes +
 * the pre-application snapshot + `rating_applied_at` stamp all commit together (§6.5
 * deep-regrade support: the snapshot is what a future admin deep-regrade restores from), so a
 * crash mid-batch leaves only fully-applied or fully-unapplied rows, never a half-written one.
 * A retried/double-fired run finds nothing left to do — see `runRatingsWeekly`'s doc comment on
 * why the no-game branch is ALSO safe to retry despite having no dedicated tracking column.
 *
 * Individual per-profile rating read/write reuses `getOrDefaultRating`/`updateRating`/
 * `incrementGamesCount` from `@receipts/db` (owned by WS11-T3's `moderation.ts`, built for its
 * own mid-week block early-conclusion path) rather than duplicating that logic — same table,
 * same pure Glicko function, one code path.
 */
import type pg from 'pg';
import { now } from '@receipts/core';
import { updateGlicko2, type GlickoGame } from '@receipts/engine';
import {
  applyDuoMatchRating,
  applyPairingRating,
  createDb,
  getDuoById,
  getOrDefaultRating,
  incrementDuoMatchesPlayed,
  incrementGamesCount,
  listActiveDuoIdsForInflation,
  listRatedProfileIdsForInflation,
  listUnappliedCompletedDuoMatches,
  listUnappliedCompletedPairings,
  lockDuoForInflation,
  lockRatingForInflation,
  lockUnappliedDuoMatch,
  lockUnappliedPairing,
  markDuoMatchRatingSkipped,
  markPairingRatingSkipped,
  updateDuoRating,
  updateRating,
  type Db,
} from '@receipts/db';
import type { JobHandler } from '../heartbeat.js';
import { logger } from '../logger.js';

/**
 * Idempotency window for the "no game this period" RD-inflation branch (§8.3). The rating
 * period is one week; a profile/duo whose `ratings`/`duos.updated_at` is more recent than this
 * many ms ago already had SOME rating activity this period (a real game applied earlier in
 * THIS run, or an inflation pass from an earlier attempt this same period) and is skipped.
 * Chosen deliberately under 7 days so mild cron jitter never skips a genuinely-idle week, while
 * staying far larger than any realistic job retry gap (minutes, not days). Job-local constant,
 * not a product-facing Appendix D number — mirrors `bot-score.ts`'s `BOT_SCORE_LOOKBACK_DAYS`
 * precedent (internal implementation windows don't need a `packages/core` contract change).
 * SPEC-GAP(ws4-t7): §8.3 doesn't say how a retried/re-fired batch should avoid double-inflating
 * an idle profile's RD (only the pairing/match consumption is explicitly guarded by
 * `rating_applied_at`) — this timestamp-window comparator is this task's chosen mechanism,
 * picked because `packages/db` schema changes (a dedicated "last inflated period" column) are
 * out of scope for this task.
 */
export const RATING_PERIOD_REPROCESS_GUARD_MS = 6 * 24 * 3600_000;

function toGlickoGame(opponent: { rating: number; rd: number }, score: 0 | 0.5 | 1): GlickoGame {
  return { opponentRating: opponent.rating, opponentRd: opponent.rd, score };
}

function gameScores(winnerId: string | null, aId: string, bId: string): [0 | 0.5 | 1, 0 | 0.5 | 1] {
  if (winnerId === aId) return [1, 0];
  if (winnerId === bId) return [0, 1];
  return [0.5, 0.5];
}

export interface RatingsWeeklyReport {
  pairingsApplied: number;
  pairingsSkippedDeletedParticipant: number;
  duoMatchesApplied: number;
  duoMatchesSkippedDisbandedParticipant: number;
  profilesInflated: number;
  duosInflated: number;
}

async function applyPairings(db: Db, pool: pg.Pool, at: Date, report: RatingsWeeklyReport): Promise<void> {
  const pairings = await listUnappliedCompletedPairings(db);
  for (const pairing of pairings) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const tx: Db = createDb(client);

      const stillUnapplied = await lockUnappliedPairing(tx, pairing.id);
      if (!stillUnapplied) {
        await client.query('ROLLBACK');
        continue;
      }

      // §8.3: "pairings/matches where a participant profile is deleted are skipped entirely
      // (no rating change for the survivor)" — still consumed (rating_applied_at stamped) so
      // the batch never retries it forever.
      if (pairing.profileAStatus === 'deleted' || pairing.profileBStatus === 'deleted') {
        await markPairingRatingSkipped(tx, pairing.id, pairing.verdict, 'participant_deleted', at);
        await client.query('COMMIT');
        report.pairingsSkippedDeletedParticipant += 1;
        continue;
      }

      const ratingA = await getOrDefaultRating(tx, pairing.profileAId);
      const ratingB = await getOrDefaultRating(tx, pairing.profileBId);
      const [scoreForA, scoreForB] = gameScores(pairing.winnerProfileId, pairing.profileAId, pairing.profileBId);

      const newA = updateGlicko2(
        { rating: ratingA.glickoRating, rd: ratingA.glickoRd, vol: ratingA.glickoVol },
        [toGlickoGame({ rating: ratingB.glickoRating, rd: ratingB.glickoRd }, scoreForA)],
      );
      const newB = updateGlicko2(
        { rating: ratingB.glickoRating, rd: ratingB.glickoRd, vol: ratingB.glickoVol },
        [toGlickoGame({ rating: ratingA.glickoRating, rd: ratingA.glickoRd }, scoreForB)],
      );

      await updateRating(tx, pairing.profileAId, newA, at);
      await updateRating(tx, pairing.profileBId, newB, at);
      await incrementGamesCount(tx, pairing.profileAId, at);
      await incrementGamesCount(tx, pairing.profileBId, at);
      // Pre-application snapshot (§6.5 deep-regrade support) + rating_applied_at, same tx as
      // the rating writes above (§8.3's explicit idempotency/atomicity rule).
      await applyPairingRating(
        tx,
        pairing.id,
        pairing.verdict,
        {
          a: { rating: ratingA.glickoRating, rd: ratingA.glickoRd, vol: ratingA.glickoVol },
          b: { rating: ratingB.glickoRating, rd: ratingB.glickoRd, vol: ratingB.glickoVol },
        },
        at,
      );

      await client.query('COMMIT');
      report.pairingsApplied += 1;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      logger.error({ err, pairingId: pairing.id }, 'ratings:weekly pairing application failed');
    } finally {
      client.release();
    }
  }
}

async function applyDuoMatches(db: Db, pool: pg.Pool, at: Date, report: RatingsWeeklyReport): Promise<void> {
  const matches = await listUnappliedCompletedDuoMatches(db);
  for (const match of matches) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const tx: Db = createDb(client);

      const stillUnapplied = await lockUnappliedDuoMatch(tx, match.id);
      if (!stillUnapplied) {
        await client.query('ROLLBACK');
        continue;
      }

      // Duo-side analogue of the deleted-profile skip (see `markDuoMatchRatingSkipped` doc).
      if (match.duoAStatus !== 'active' || match.duoBStatus !== 'active') {
        await markDuoMatchRatingSkipped(tx, match.id, at);
        await client.query('COMMIT');
        report.duoMatchesSkippedDisbandedParticipant += 1;
        continue;
      }

      const duoA = await getDuoById(tx, match.duoAId);
      const duoB = await getDuoById(tx, match.duoBId);
      if (!duoA || !duoB) {
        // Defensive: FK guarantees these exist; nothing to do if somehow missing.
        await client.query('ROLLBACK');
        continue;
      }
      const [scoreForA, scoreForB] = gameScores(match.winnerDuoId, duoA.id, duoB.id);

      const newA = updateGlicko2(
        { rating: duoA.glickoRating, rd: duoA.glickoRd, vol: duoA.glickoVol },
        [toGlickoGame({ rating: duoB.glickoRating, rd: duoB.glickoRd }, scoreForA)],
      );
      const newB = updateGlicko2(
        { rating: duoB.glickoRating, rd: duoB.glickoRd, vol: duoB.glickoVol },
        [toGlickoGame({ rating: duoA.glickoRating, rd: duoA.glickoRd }, scoreForB)],
      );

      await updateDuoRating(tx, duoA.id, newA, at);
      await updateDuoRating(tx, duoB.id, newB, at);
      await incrementDuoMatchesPlayed(tx, duoA.id, at);
      await incrementDuoMatchesPlayed(tx, duoB.id, at);
      await applyDuoMatchRating(
        tx,
        match.id,
        {
          a: { rating: duoA.glickoRating, rd: duoA.glickoRd, vol: duoA.glickoVol },
          b: { rating: duoB.glickoRating, rd: duoB.glickoRd, vol: duoB.glickoVol },
        },
        at,
      );

      await client.query('COMMIT');
      report.duoMatchesApplied += 1;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      logger.error({ err, matchId: match.id }, 'ratings:weekly duo match application failed');
    } finally {
      client.release();
    }
  }
}

async function inflateIdleProfiles(db: Db, pool: pg.Pool, at: Date, threshold: Date, report: RatingsWeeklyReport): Promise<void> {
  const idleProfileIds = await listRatedProfileIdsForInflation(db, threshold);
  for (const profileId of idleProfileIds) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const tx: Db = createDb(client);
      const rating = await lockRatingForInflation(tx, profileId);
      if (!rating || rating.updatedAt >= threshold) {
        await client.query('ROLLBACK');
        continue;
      }
      const inflated = updateGlicko2({ rating: rating.rating, rd: rating.rd, vol: rating.vol }, []);
      await updateRating(tx, profileId, inflated, at);
      await client.query('COMMIT');
      report.profilesInflated += 1;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      logger.error({ err, profileId }, 'ratings:weekly no-game inflation failed for profile');
    } finally {
      client.release();
    }
  }
}

async function inflateIdleDuos(db: Db, pool: pg.Pool, at: Date, threshold: Date, report: RatingsWeeklyReport): Promise<void> {
  const idleDuoIds = await listActiveDuoIdsForInflation(db, threshold);
  for (const duoId of idleDuoIds) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const tx: Db = createDb(client);
      const duo = await lockDuoForInflation(tx, duoId);
      if (!duo || duo.status !== 'active' || duo.updatedAt >= threshold) {
        await client.query('ROLLBACK');
        continue;
      }
      const inflated = updateGlicko2({ rating: duo.rating, rd: duo.rd, vol: duo.vol }, []);
      await updateDuoRating(tx, duoId, inflated, at);
      await client.query('COMMIT');
      report.duosInflated += 1;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      logger.error({ err, duoId }, 'ratings:weekly no-game inflation failed for duo');
    } finally {
      client.release();
    }
  }
}

export async function runRatingsWeekly(db: Db, pool: pg.Pool, at: Date = now()): Promise<RatingsWeeklyReport> {
  const report: RatingsWeeklyReport = {
    pairingsApplied: 0,
    pairingsSkippedDeletedParticipant: 0,
    duoMatchesApplied: 0,
    duoMatchesSkippedDisbandedParticipant: 0,
    profilesInflated: 0,
    duosInflated: 0,
  };

  await applyPairings(db, pool, at, report);
  await applyDuoMatches(db, pool, at, report);

  // No-game inflation runs AFTER the above so any profile/duo just touched by a real game this
  // run already has `updated_at = at` and is naturally excluded by the threshold comparison.
  const threshold = new Date(at.getTime() - RATING_PERIOD_REPROCESS_GUARD_MS);
  await inflateIdleProfiles(db, pool, at, threshold, report);
  await inflateIdleDuos(db, pool, at, threshold, report);

  return report;
}

export const ratingsWeeklyHandler: JobHandler = async (ctx) => {
  const report = await runRatingsWeekly(ctx.db, ctx.pool);
  logger.info({ report }, 'ratings:weekly complete');
};
