/**
 * Settlement/grading repository helpers (WS1-T5; §6.5, §7.5). Grading writes go through a
 * caller-supplied `Db` bound to ONE transactional client so `grade:followup` can be enqueued
 * in the same Postgres transaction (pg-boss rides the same DB — §6.5 "a worker crash after
 * commit can never leave a half-processed question").
 */
import { eq, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { markets, questions } from '../schema/index.js';

export interface LockedQuestionForSettlement {
  questionId: string;
  marketId: string;
  venue: string;
  venueMarketId: string;
}

/** `locked` questions are exactly `settlement:poll`'s scope (§7.5). */
export async function listLockedQuestionsForSettlement(
  db: Db,
): Promise<LockedQuestionForSettlement[]> {
  return db
    .select({
      questionId: questions.id,
      marketId: markets.id,
      venue: markets.venue,
      venueMarketId: markets.venueMarketId,
    })
    .from(questions)
    .innerJoin(markets, eq(questions.marketId, markets.id))
    .where(eq(questions.status, 'locked'));
}

export interface GradeResolvedResult {
  /** False when already graded (idempotent re-run: settled_at was already set). */
  graded: boolean;
  winCount: number;
  lossCount: number;
}

/**
 * Grades a resolved question inside `tx` (§6.5): copies outcome+settledAt (guarded on
 * `settled_at IS NULL` — idempotent re-run is a no-op) and grades pending picks win/loss/edge
 * (`edge = (win?1:0) − p_side_entry`, `p_side_entry = side='yes' ? yes_price_at_entry :
 * 1 − yes_price_at_entry`). Question `status` stays `'locked'` — the publication rule (§6.5)
 * defers the `'locked' → 'revealed'` transition to `reveal:fire` (WS3-T4), so grading here
 * never leaks results early. Caller enqueues `grade:followup` transactionally iff `graded`.
 */
export async function gradeResolvedQuestionTx(
  tx: Db,
  questionId: string,
  outcome: 'yes' | 'no',
  settledAt: Date,
): Promise<GradeResolvedResult> {
  const updated = await tx.execute(sql`
    UPDATE questions
    SET outcome = ${outcome},
        settled_at = ${settledAt.toISOString()}::timestamptz,
        updated_at = ${settledAt.toISOString()}::timestamptz
    WHERE id = ${questionId} AND status = 'locked' AND settled_at IS NULL
    RETURNING id
  `);
  if ((updated.rowCount ?? 0) === 0) return { graded: false, winCount: 0, lossCount: 0 };

  const graded = await tx.execute(sql`
    UPDATE picks
    SET result = (CASE WHEN side = ${outcome} THEN 'win' ELSE 'loss' END)::pick_result,
        edge = (CASE WHEN side = ${outcome} THEN 1 ELSE 0 END)
               - (CASE WHEN side = 'yes' THEN yes_price_at_entry ELSE 1 - yes_price_at_entry END),
        graded_at = ${settledAt.toISOString()}::timestamptz
    WHERE question_id = ${questionId} AND result = 'pending'
    RETURNING result
  `);
  const rows = graded.rows as Array<{ result: string }>;
  return {
    graded: true,
    winCount: rows.filter((r) => r.result === 'win').length,
    lossCount: rows.filter((r) => r.result === 'loss').length,
  };
}

/** Voids every non-void pick for a question (§6.5 "all picks result='void'") — shared by
 * `voidQuestionTx` below and WS10-T3's post-reveal admin void path (paired there with
 * `voidRevealedQuestionTx`, `../repositories/questions.ts`, which only flips the question's own
 * status and explicitly defers pick-handling to this file). Returns the affected profile ids so
 * a post-reveal caller can replay their streaks (§6.6) — picks voided before reveal never had
 * their streak mutated in the first place (§6.6: "all streak mutation happens at reveal time or
 * later"), so pre-reveal callers can safely ignore the return value. */
export async function voidAllPicksForQuestionTx(
  tx: Db,
  questionId: string,
  at: Date,
): Promise<{ affectedProfileIds: string[] }> {
  const voided = await tx.execute(sql`
    UPDATE picks
    SET result = 'void', edge = NULL, graded_at = ${at.toISOString()}::timestamptz
    WHERE question_id = ${questionId} AND result != 'void'
    RETURNING profile_id
  `);
  return { affectedProfileIds: (voided.rows as Array<{ profile_id: string }>).map((r) => r.profile_id) };
}

export interface VoidQuestionResult {
  /** False when not eligible (idempotent re-run: status was already voided, or is 'revealed' —
   * see `voidRevealedQuestionTx`/WS10-T3 for that separately-gated path). */
  voided: boolean;
  voidedPickCount: number;
}

/**
 * Voids a question inside `tx` (§6.5: "voided reachable from scheduled|open|locked") — question
 * → `voided`, every non-void pick → `result='void', edge=null`. Voiding is immediate (no reveal
 * gate) for these pre-reveal states — void days never count for/against streaks (§6.6), so
 * there's nothing to keep hidden until a synchronized moment, and (per §6.6 "all streak
 * mutation happens at reveal time or later") no streak replay is ever needed for this path: a
 * question that never reached `revealed` never mutated any streak to begin with. Originally
 * scoped to `status='locked'` only (WS1-T5, `settlement:poll`'s venue-triggered void) and to
 * `result='pending'` picks only; WS10-T3 broadened both — the status set to cover the admin's
 * pre-reveal override (scheduled/open questions can be voided too), and the pick filter to
 * `!= 'void'` (a `locked` question can already be graded — win/loss picks, per §6.5's
 * publication rule — before reveal fires; those must be voided too, not left stranded).
 */
export async function voidQuestionTx(
  tx: Db,
  questionId: string,
  at: Date,
  voidReason = 'venue_voided',
): Promise<VoidQuestionResult> {
  const updated = await tx.execute(sql`
    UPDATE questions
    SET status = 'voided', void_reason = ${voidReason}, updated_at = ${at.toISOString()}::timestamptz
    WHERE id = ${questionId} AND status IN ('scheduled', 'open', 'locked')
    RETURNING id
  `);
  if ((updated.rowCount ?? 0) === 0) return { voided: false, voidedPickCount: 0 };

  const { affectedProfileIds } = await voidAllPicksForQuestionTx(tx, questionId, at);
  return { voided: true, voidedPickCount: affectedProfileIds.length };
}

export interface RegradeResult {
  /** False when not eligible (idempotent re-run guard: question wasn't `revealed`). */
  regraded: boolean;
  /** Profile ids whose pick was re-scored — caller replays each one's streak (§6.6) and
   * recomputes percentiles when this is non-empty. */
  affectedProfileIds: string[];
}

/**
 * Regrades an already-revealed question inside `tx` (§6.5 "admin can flip an outcome within
 * REGRADE_WINDOW_H"; the window itself is the caller's (WS10-T3) responsibility to check
 * against `revealed_at` before calling this — this function only enforces the state guard).
 * Re-scores EVERY pick for the question (not just `pending` ones, unlike `gradeResolvedQuestionTx`
 * — a revealed question's picks are always already win/loss, never pending) against the new
 * outcome. Scope: daily questions only in this wave — nemesis/duo bonus questions don't exist
 * yet (matches `grade:followup`'s own SPEC-GAP), so the "any pairing/duo scoring that consumed
 * it" + deep-regrade rating-restoration paths (§6.5) have nothing to restore against; the
 * caller refuses non-daily regrade rather than silently under-scoring a future pairing/match.
 */
export async function regradeRevealedQuestionTx(
  tx: Db,
  questionId: string,
  newOutcome: 'yes' | 'no',
  at: Date,
): Promise<RegradeResult> {
  const updated = await tx.execute(sql`
    UPDATE questions
    SET outcome = ${newOutcome}, updated_at = ${at.toISOString()}::timestamptz
    WHERE id = ${questionId} AND status = 'revealed'
    RETURNING id
  `);
  if ((updated.rowCount ?? 0) === 0) return { regraded: false, affectedProfileIds: [] };

  const regraded = await tx.execute(sql`
    UPDATE picks
    SET result = (CASE WHEN side = ${newOutcome} THEN 'win' ELSE 'loss' END)::pick_result,
        edge = (CASE WHEN side = ${newOutcome} THEN 1 ELSE 0 END)
               - (CASE WHEN side = 'yes' THEN yes_price_at_entry ELSE 1 - yes_price_at_entry END),
        graded_at = ${at.toISOString()}::timestamptz
    WHERE question_id = ${questionId}
    RETURNING profile_id
  `);
  return { regraded: true, affectedProfileIds: (regraded.rows as Array<{ profile_id: string }>).map((r) => r.profile_id) };
}
