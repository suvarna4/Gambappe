/**
 * Duo match completion + chemistry (design doc §8.9, WS6-T2). NORMAL completion only — i.e.
 * every one of the match's own questions has settled naturally, whether via the timely
 * publication pipeline (`grade:followup` for `duo_bonus`, `reveal:fire` for `daily`) or via
 * `duo:window-roll`'s straggler backstop for a match whose window has fully elapsed (§8.5: "or
 * by the next window-roll as a backstop for stragglers, excluding never-graded questions").
 *
 * This is distinct from the §5.7 MID-WINDOW EXIT rule (block/suspend/delete) — see
 * `apps/web/lib/duo-match-lifecycle.ts` for that path, which applies rating immediately and can
 * end in `cancelled`. This path never cancels (a match that's run its course always
 * `completed`s, even 0-0 if every question ended up excluded — `scoreDuoMatch`'s exclusion
 * handling already degrades gracefully to a 0-0 draw) and never applies rating itself: §8.3
 * defers duo Glicko application to the weekly `ratings:weekly` batch (WS4-T7, still a registry
 * stub as of this task), same as nemesis. `ratingAppliedAt` is left null here on purpose — the
 * batch's own idempotency guard (`rating_applied_at IS NULL`) will pick this match up.
 */
import { computeDuoSynergy, scoreDuoMatch } from '@receipts/engine';
import {
  computeLifetimeAccuracy,
  getDuoById,
  getDuoLifetimeSlots,
  getDuoMatchById,
  getDuoMatchScoringInput,
  incrementDuoMatchesPlayed,
  isDuoMatchFullyGraded,
  updateDuoChemistry,
  updateDuoMatchConclusion,
  type Db,
} from '@receipts/db';
import { logger } from '../logger.js';

/** Recomputes + persists `duoId`'s chemistry from its FULL lifetime slot history (§8.9) — a
 * no-op while there are zero lifetime slots (nothing graded yet), leaving `joint_hit_rate`/
 * `synergy` at their `null` schema default rather than writing a misleading `0`. */
export async function refreshDuoChemistry(db: Db, duoId: string, at: Date): Promise<void> {
  const duo = await getDuoById(db, duoId);
  if (!duo) return;
  const slots = await getDuoLifetimeSlots(db, duoId);
  if (slots.length === 0) return;

  const [accuracyA, accuracyB] = await Promise.all([
    computeLifetimeAccuracy(db, duo.profileAId),
    computeLifetimeAccuracy(db, duo.profileBId),
  ]);
  const { jointHitRate, synergy } = computeDuoSynergy({
    slots,
    partnerAAccuracy: accuracyA,
    partnerBAccuracy: accuracyB,
  });
  await updateDuoChemistry(db, duoId, jointHitRate, synergy, at);
}

export interface CompleteDuoMatchResult {
  completed: boolean;
  scoreA?: number;
  scoreB?: number;
  winner?: 'a' | 'b' | 'draw';
}

export interface TryCompleteDuoMatchOptions {
  /** `duo:window-roll`'s straggler backstop (§8.5: "excluding never-graded questions per
   * §8.9"): completes the match on whatever's settled even if some questions never graded —
   * `scoreDuoMatch`'s existing exclusion handling (packages/engine) already degrades gracefully
   * (an all-excluded match just scores 0-0, a draw). Normal callers (`grade:followup`,
   * `reveal:fire`) never pass this — they only ever fire once a question they JUST settled
   * might be the match's last one, so requiring `isDuoMatchFullyGraded` first is correct there. */
  force?: boolean;
}

/**
 * Checks whether `matchId`'s own questions (3 daily + 0–3 bonus) are all settled, and if so
 * scores + completes it (§8.9) and refreshes both duos' chemistry. Idempotent: a match already
 * `completed`/`cancelled` is a no-op (the explicit status guard below — mirrors the
 * status-checked-first idempotency pattern used throughout this codebase's §5.7 transitions,
 * e.g. `revealQuestionTx`/`lockQuestionTx`), so calling this redundantly from multiple hook
 * points (`grade:followup`, `reveal:fire`, the window-roll backstop) for the same match is safe.
 */
export async function tryCompleteDuoMatch(
  db: Db,
  matchId: string,
  at: Date,
  options: TryCompleteDuoMatchOptions = {},
): Promise<CompleteDuoMatchResult> {
  const match = await getDuoMatchById(db, matchId);
  if (!match || (match.status !== 'scheduled' && match.status !== 'active')) {
    return { completed: false };
  }

  const scoring = await getDuoMatchScoringInput(db, matchId);
  if (scoring.length === 0) return { completed: false }; // malformed/unlinked match — never force-complete garbage
  if (!options.force && !isDuoMatchFullyGraded(scoring)) return { completed: false };

  const { scoreA, scoreB, winner } = scoreDuoMatch(scoring);
  const winnerDuoId = winner === 'a' ? match.duoAId : winner === 'b' ? match.duoBId : null;

  await updateDuoMatchConclusion(db, matchId, { status: 'completed', scoreA, scoreB, winnerDuoId }, at);
  await incrementDuoMatchesPlayed(db, match.duoAId, at);
  await incrementDuoMatchesPlayed(db, match.duoBId, at);
  await refreshDuoChemistry(db, match.duoAId, at);
  await refreshDuoChemistry(db, match.duoBId, at);

  logger.info({ matchId, scoreA, scoreB, winner }, 'duo:match completed (§8.9)');
  return { completed: true, scoreA, scoreB, winner };
}
