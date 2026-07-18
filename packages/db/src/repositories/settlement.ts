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

export interface VoidQuestionResult {
  /** False when already voided (idempotent re-run: status wasn't 'locked'). */
  voided: boolean;
  voidedPickCount: number;
}

/**
 * Voids a question inside `tx` (§6.5): question → `voided` (guarded on `status = 'locked'` —
 * idempotent re-run is a no-op), all pending picks → `result='void', edge=null`. Unlike
 * resolution, voiding is immediate (no reveal gate) — void days never count for/against
 * streaks (§6.6), so there's nothing to keep hidden until a synchronized moment.
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
    WHERE id = ${questionId} AND status = 'locked'
    RETURNING id
  `);
  if ((updated.rowCount ?? 0) === 0) return { voided: false, voidedPickCount: 0 };

  const voidedPicks = await tx.execute(sql`
    UPDATE picks
    SET result = 'void', edge = NULL, graded_at = ${at.toISOString()}::timestamptz
    WHERE question_id = ${questionId} AND result = 'pending'
    RETURNING id
  `);
  return { voided: true, voidedPickCount: voidedPicks.rowCount ?? 0 };
}
