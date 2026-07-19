/**
 * `nemesis:conclude` (WS5-T3, §8.8, §7.6 Sun 22:00 ET): week scoring + verdict bundle for every
 * currently-`active` nemesis pairing. By definition every `active` pairing at this cron fire
 * belongs to the concluding week — `nemesis:assign` only ever creates NEXT week's pairings, the
 * following Monday (§8.4) — so no extra week filter is needed on top of
 * `listActiveNemesisPairings`.
 *
 * Runs ONE HOUR BEFORE `ratings:weekly` (Sun 23:00 ET) — this ordering is load-bearing, do not
 * change it: this job flips each concluding pairing to `status='completed'` with a verdict but
 * deliberately leaves `rating_applied_at` NULL, so `ratings:weekly`'s
 * `listUnappliedCompletedPairings` (`WHERE status='completed' AND rating_applied_at IS NULL`)
 * picks it up an hour later and applies Glicko-2 itself. `ratings:weekly`'s `applyPairingRating`
 * then spread-merges a `rating_before` snapshot into THIS job's verdict object (§6.5 deep-regrade
 * support) — so the verdict written here is a flat plain object with no `rating_before` key of
 * its own, and that later merge never clobbers anything this job wrote.
 *
 * (Contrast with `../lib/pairing-lifecycle.ts`'s `applyPairingMidWeekExit`, the mid-week-exit
 * sibling: THAT function DOES pass `ratingAppliedAt` and applies the rating itself immediately,
 * because a mid-week exit is a one-off early conclusion outside the normal weekly batch. This
 * job is the normal end-of-week path and must not copy that part of its behavior.)
 *
 * Per pairing, inside one transaction (mirrors `pairing-lifecycle.ts`'s `applyPairingMidWeekExit`
 * tx shape):
 *   - idempotency re-check: pairing must still be `status === 'active'` inside the tx — the
 *     `listActiveNemesisPairings` read above happens outside the tx and could be stale under a
 *     concurrent double-fire (pg-boss's singleton weekly cron is the primary guard, §19.4 rule
 *     4; this is defense-in-depth).
 *   - `getFullPairingSharedQuestionPicks` (dailies ∪ bonus) — NOT `moderation.ts`'s bonus-only
 *     `getPairingSharedQuestionPicks`, a documented gap that would silently under-score almost
 *     every week (7 dailies vs 0–3 bonus questions).
 *   - `scoreNemesisWeek` (WS4-T6, `@receipts/engine`) — the exact tie→edge→draw cascade the AC
 *     asks for (1 pt per shared Q iff picked+won; tie on score → higher Σedge; |Δedge| < 1e-4 →
 *     draw; void/unsettled questions excluded and reported back). Not reimplemented here.
 *   - `updatePairingConclusion(..., { status: 'completed', ... })` with `ratingAppliedAt`
 *     omitted (see header).
 *   - win/loss/draw beats (`nemesis_verdict_win`/`_loss`/`_draw`, §13.3) derived pure
 *     (`../notifications/nemesis-verdict-beats.js`) and written to the outbox in the same tx —
 *     so a rollback never leaves an orphaned beat, and the `dedupe_key` unique constraint makes
 *     a genuine re-fire a safe no-op.
 *
 * Behind the `nemesis` flag (§4.6: "off until WS5 E2E passes") — same posture as
 * `nemesis:assign`.
 */
import { addDaysToDateString, isFlagEnabled, now } from '@receipts/core';
import { narrate, scoreNemesisWeek, type NarrationLine } from '@receipts/engine';
import {
  getFullPairingSharedQuestionPicks,
  getPairingById,
  getProfileById,
  listActiveNemesisPairings,
  updatePairingConclusion,
  type ActiveNemesisPairing,
  type Db,
} from '@receipts/db';
import type { JobHandler } from '../heartbeat.js';
import { logger } from '../logger.js';
import { deriveNemesisVerdictBeats } from '../notifications/nemesis-verdict-beats.js';
import { writeBeatsToOutbox } from '../notifications/write-outbox.js';

export interface NemesisConcludeReport {
  activePairings: number;
  concluded: number;
  skippedNotActive: number;
  beatsWritten: number;
}

interface PairingConcludeOutcome {
  concluded: boolean;
  beatsWritten: number;
}

function narrationFor(
  side: 'a' | 'b',
  winner: 'a' | 'b' | 'draw',
  myScore: number,
  opponentScore: number,
  myHandle: string,
  opponentHandle: string,
): NarrationLine {
  if (winner === 'draw') {
    return narrate({ beat: 'nemesis_verdict_draw', data: { opponentHandle, myScore, opponentScore } });
  }
  if (winner === side) {
    return narrate({ beat: 'nemesis_verdict_win', data: { opponentHandle, myScore, opponentScore } });
  }
  return narrate({
    beat: 'nemesis_verdict_loss',
    data: { winnerHandle: opponentHandle, winnerScore: opponentScore, loserScore: myScore },
  });
}

async function concludeOnePairing(db: Db, pairing: ActiveNemesisPairing, at: Date): Promise<PairingConcludeOutcome> {
  return db.transaction(async (tx) => {
    const current = await getPairingById(tx, pairing.id);
    if (!current || current.status !== 'active') {
      return { concluded: false, beatsWritten: 0 };
    }

    const weekEnd = addDaysToDateString(pairing.weekStart, 6);
    const sharedQuestions = await getFullPairingSharedQuestionPicks(
      tx,
      { id: pairing.id, weekStart: pairing.weekStart, weekEnd },
      pairing.profileAId,
      pairing.profileBId,
    );
    const { scoreA, scoreB, edgeA, edgeB, winner, excludedQuestionIds } = scoreNemesisWeek(
      sharedQuestions.map((q) => ({
        questionId: q.questionId,
        isVoid: q.isVoid,
        isSettled: q.isSettled,
        profileA: q.profileAPick,
        profileB: q.profileBPick,
      })),
    );
    const winnerProfileId = winner === 'draw' ? null : winner === 'a' ? pairing.profileAId : pairing.profileBId;

    const [profileA, profileB] = await Promise.all([
      getProfileById(tx, pairing.profileAId),
      getProfileById(tx, pairing.profileBId),
    ]);
    const handleA = profileA?.handle ?? pairing.profileAId;
    const handleB = profileB?.handle ?? pairing.profileBId;

    const narrationA = narrationFor('a', winner, scoreA, scoreB, handleA, handleB);
    const narrationB = narrationFor('b', winner, scoreB, scoreA, handleB, handleA);

    // Flat plain object (§6.5): `ratings:weekly`'s `applyPairingRating` spread-merges a
    // `rating_before` key into this SAME verdict an hour later — no conflicting key here.
    const verdict = {
      scoreA,
      scoreB,
      edgeA,
      edgeB,
      winner,
      excludedQuestionIds,
      narration: {
        [pairing.profileAId]: { line: narrationA.line, emphasis: narrationA.emphasis ?? null },
        [pairing.profileBId]: { line: narrationB.line, emphasis: narrationB.emphasis ?? null },
      },
    };

    await updatePairingConclusion(
      tx,
      pairing.id,
      { status: 'completed', scoreA, scoreB, edgeA, edgeB, winnerProfileId, verdict },
      at,
    );

    const beats = deriveNemesisVerdictBeats({
      pairingId: pairing.id,
      winner,
      profileAId: pairing.profileAId,
      profileBId: pairing.profileBId,
      narrationA,
      narrationB,
    });
    const outboxReport = await writeBeatsToOutbox(tx, beats, at);

    return { concluded: true, beatsWritten: outboxReport.written };
  });
}

export async function runNemesisConclude(db: Db, at: Date = now()): Promise<NemesisConcludeReport> {
  const pairings = await listActiveNemesisPairings(db);
  const report: NemesisConcludeReport = {
    activePairings: pairings.length,
    concluded: 0,
    skippedNotActive: 0,
    beatsWritten: 0,
  };

  for (const pairing of pairings) {
    try {
      const outcome = await concludeOnePairing(db, pairing, at);
      if (outcome.concluded) {
        report.concluded += 1;
        report.beatsWritten += outcome.beatsWritten;
      } else {
        report.skippedNotActive += 1;
      }
    } catch (err) {
      logger.error({ err, pairingId: pairing.id }, 'nemesis:conclude — pairing scoring failed');
    }
  }

  return report;
}

export const nemesisConcludeHandler: JobHandler = async (ctx) => {
  if (!isFlagEnabled('nemesis')) {
    logger.debug('nemesis:conclude skipped — nemesis flag disabled');
    return;
  }
  const report = await runNemesisConclude(ctx.db);
  logger.info({ report }, 'nemesis:conclude complete');
};
