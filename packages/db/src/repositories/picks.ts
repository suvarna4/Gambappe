/**
 * Pick repository helpers (WS0-T3 + WS3-T2/T5 additions). The full §6.2 pick algorithm (price
 * stamping, clock authority, counters) lives here as `placePickTx`/`undoPickTx`.
 */
import { and, count, eq, or, sql } from 'drizzle-orm';
import { BOT_EXCLUDE_THRESHOLD } from '@receipts/core';
import type { Db } from '../client.js';
import { picks, questions } from '../schema/index.js';

export type PickRow = typeof picks.$inferSelect;
export type NewPickRow = typeof picks.$inferInsert;

export async function insertPick(db: Db, row: NewPickRow): Promise<PickRow> {
  const [inserted] = await db.insert(picks).values(row).returning();
  if (!inserted) throw new Error('insertPick: no row returned');
  return inserted;
}

export async function getPicksForQuestion(db: Db, questionId: string): Promise<PickRow[]> {
  return db.select().from(picks).where(eq(picks.questionId, questionId));
}

export async function getPick(
  db: Db,
  questionId: string,
  profileId: string,
): Promise<PickRow | null> {
  const [row] = await db
    .select()
    .from(picks)
    .where(and(eq(picks.questionId, questionId), eq(picks.profileId, profileId)))
    .limit(1);
  return row ?? null;
}

export async function getPickById(db: Db, id: string): Promise<PickRow | null> {
  const [row] = await db.select().from(picks).where(eq(picks.id, id)).limit(1);
  return row ?? null;
}

/** Postgres error code, unwrapping drizzle-orm's `DrizzleQueryError` wrapper if present. */
function pgErrorCode(err: unknown): string | undefined {
  const withCode = err as { code?: string; cause?: { code?: string } };
  return withCode.cause?.code ?? withCode.code;
}

const UNIQUE_VIOLATION = '23505';

export interface PlacePickInput {
  id: string;
  questionId: string;
  profileId: string;
  side: 'yes' | 'no';
  yesPriceAtEntry: number;
  priceStampedAt: Date;
  pickedAt: Date;
  source: 'web' | 'share_card' | 'spectator_page';
  confidence?: number | null;
}

export type PlacePickResult =
  | { outcome: 'inserted'; pick: PickRow }
  | { outcome: 'question_locked' }
  | { outcome: 'already_picked'; pick: PickRow };

/**
 * §6.2 steps 3+5: places a pick inside one transaction. The guarded counter UPDATE on the
 * question row is BOTH the clock-authority check and the serialization point — Postgres (not
 * app code) evaluates `status = 'open' AND lock_at > now()` in the same statement that
 * increments the crowd counter, taking one exclusive row lock up front. Holding that lock for
 * the transaction's duration blocks a concurrent `question:lock` job's `FOR UPDATE` until we
 * commit or roll back, so a pick can never slip in between the lock job's status flip and its
 * counter snapshot (§6.2).
 *
 * Deliberately NOT `SELECT ... FOR SHARE` + a later counter UPDATE: two concurrent picks on the
 * same question would each hold the share lock while waiting to upgrade for the UPDATE — a
 * guaranteed 40P01 deadlock on the hottest row in the product (everyone picks the same daily
 * question). One exclusive lock from the first statement means concurrent pickers briefly
 * serialize on the increment instead.
 *
 * Unique violation on `(question_id, profile_id)` → `already_picked` with the existing row
 * (idempotent-friendly 409, §6.2 step 5 / Appendix C `ALREADY_PICKED`). The increment runs
 * INSIDE the savepoint with the insert, so that rollback also undoes the counter bump.
 */
export async function placePickTx(db: Db, input: PlacePickInput): Promise<PlacePickResult> {
  return db.transaction(async (tx) => {
    try {
      // Nested transaction (Postgres SAVEPOINT under the hood, drizzle-orm): a unique-violation
      // here only rolls back TO the savepoint — undoing the counter increment with it — while
      // leaving the outer transaction usable for the `getPick` lookup below. Without it,
      // Postgres marks the whole transaction aborted after any error and every subsequent
      // statement fails with 25P02.
      const inserted = await tx.transaction(async (tx2) => {
        const countColumn = input.side === 'yes' ? sql`yes_count` : sql`no_count`;
        const guard = await tx2.execute(sql`
          UPDATE questions
          SET ${countColumn} = ${countColumn} + 1, updated_at = ${input.pickedAt}
          WHERE id = ${input.questionId} AND status = 'open' AND lock_at > now()
          RETURNING id
        `);
        if ((guard.rowCount ?? 0) === 0) return null;

        const [row2] = await tx2
          .insert(picks)
          .values({
            id: input.id,
            questionId: input.questionId,
            profileId: input.profileId,
            side: input.side,
            yesPriceAtEntry: input.yesPriceAtEntry,
            priceStampedAt: input.priceStampedAt,
            pickedAt: input.pickedAt,
            source: input.source,
            confidence: input.confidence ?? null,
          })
          .returning();
        if (!row2) throw new Error('placePickTx: no row returned from insert');
        return row2;
      });

      if (!inserted) return { outcome: 'question_locked' };
      return { outcome: 'inserted', pick: inserted };
    } catch (err) {
      if (pgErrorCode(err) === UNIQUE_VIOLATION) {
        const existing = await getPick(tx, input.questionId, input.profileId);
        if (existing) return { outcome: 'already_picked', pick: existing };
      }
      throw err;
    }
  });
}

export type UndoPickResult =
  | { outcome: 'deleted'; questionId: string; side: 'yes' | 'no' }
  | { outcome: 'not_found' }
  | { outcome: 'forbidden' }
  | { outcome: 'expired' };

/**
 * §6.2 undo: `DELETE /picks/:id`. Ownership is checked app-side (cheap, no race risk — a pick's
 * `profile_id` never changes post-insert outside merge). The window/lock checks are evaluated
 * IN POSTGRES on the same statement that deletes (clock-authority rule, same as placement) —
 * `picked_at + undoWindowS > now() AND lock_at > now()` — so an expired/post-lock undo can never
 * race a slow app clock into succeeding. Hard delete + counter decrement in one transaction.
 */
export async function undoPickTx(
  db: Db,
  pickId: string,
  callerProfileId: string,
  undoWindowS: number,
): Promise<UndoPickResult> {
  return db.transaction(async (tx) => {
    const existing = await getPickById(tx, pickId);
    if (!existing) return { outcome: 'not_found' };
    if (existing.profileId !== callerProfileId) return { outcome: 'forbidden' };

    const deleted = await tx.execute(sql`
      DELETE FROM picks p
      USING questions q
      WHERE p.id = ${pickId}
        AND q.id = p.question_id
        AND p.picked_at + (${undoWindowS} * interval '1 second') > now()
        AND q.lock_at > now()
      RETURNING p.side, p.question_id
    `);
    if ((deleted.rowCount ?? 0) === 0) return { outcome: 'expired' };

    const side = deleted.rows[0]!['side'] as 'yes' | 'no';
    const questionId = deleted.rows[0]!['question_id'] as string;
    const column = side === 'yes' ? questions.yesCount : questions.noCount;
    await tx
      .update(questions)
      .set({ [side === 'yes' ? 'yesCount' : 'noCount']: sql`greatest(${column} - 1, 0)` })
      .where(eq(questions.id, questionId));

    return { outcome: 'deleted', questionId, side };
  });
}

export interface GradedPickScore {
  profileId: string;
  edge: number;
}

/**
 * Graded (win/loss) picks on a question, excluding `bot_score >= BOT_EXCLUDE_THRESHOLD`
 * profiles (§8.6 percentile denominator — excluded profiles never appear in others').
 */
export async function getGradedPickScoresForQuestion(db: Db, questionId: string): Promise<GradedPickScore[]> {
  const rows = await db.execute(sql`
    SELECT p.profile_id, p.edge
    FROM picks p
    JOIN profiles pr ON pr.id = p.profile_id
    WHERE p.question_id = ${questionId}
      AND p.result IN ('win', 'loss')
      AND pr.bot_score < ${BOT_EXCLUDE_THRESHOLD}
  `);
  return rows.rows.map((r) => ({ profileId: r['profile_id'] as string, edge: Number(r['edge']) }));
}

/**
 * Same as `getGradedPickScoresForQuestion` but WITHOUT the bot exclusion — §8.6's other half:
 * "excluded profiles get their own percentile against the full set" (they just never appear in
 * anyone else's denominator). Only ever used to compute a single bot-excluded profile's own
 * percentile on demand — never for the shared cached denominator every other viewer reads.
 */
export async function getAllGradedPickScoresForQuestion(db: Db, questionId: string): Promise<GradedPickScore[]> {
  const rows = await db.execute(sql`
    SELECT p.profile_id, p.edge
    FROM picks p
    WHERE p.question_id = ${questionId}
      AND p.result IN ('win', 'loss')
  `);
  return rows.rows.map((r) => ({ profileId: r['profile_id'] as string, edge: Number(r['edge']) }));
}

/** All (any-status, excludes bot-scored) graded picks by a profile — §6.6 replay input. */
export async function getPicksForProfile(db: Db, profileId: string): Promise<PickRow[]> {
  return db.select().from(picks).where(eq(picks.profileId, profileId));
}

export interface GradedPickForReveal {
  profileId: string;
  result: 'win' | 'loss';
  edge: number;
  side: 'yes' | 'no';
  yesPriceAtEntry: number;
}

/** Win/loss picks on a question — `reveal:fire`'s participant list (§6.6/§6.7): who to apply
 * the streak gap-rule increment to, and who's eligible for the "called it" badge check. */
export async function getGradedPicksForQuestion(db: Db, questionId: string): Promise<GradedPickForReveal[]> {
  const rows = await db
    .select({
      profileId: picks.profileId,
      result: picks.result,
      edge: picks.edge,
      side: picks.side,
      yesPriceAtEntry: picks.yesPriceAtEntry,
    })
    .from(picks)
    .where(and(eq(picks.questionId, questionId), or(eq(picks.result, 'win'), eq(picks.result, 'loss'))));
  return rows.map((r) => ({
    profileId: r.profileId,
    result: r.result as 'win' | 'loss',
    edge: Number(r.edge),
    side: r.side,
    yesPriceAtEntry: Number(r.yesPriceAtEntry),
  }));
}

export interface ProfilePickRecord {
  wins: number;
  losses: number;
  voids: number;
}

/**
 * WS8-T1 (§10.5 `profile` OG template — record summary): graded win/loss/void counts for a
 * profile, straight off `picks` (no snapshot table at this scope — cheap enough for a
 * once-per-render, cache-addressed image fetch).
 */
export async function getProfilePickRecord(db: Db, profileId: string): Promise<ProfilePickRecord> {
  const rows = await db
    .select({ result: picks.result, n: count() })
    .from(picks)
    .where(eq(picks.profileId, profileId))
    .groupBy(picks.result);
  const record: ProfilePickRecord = { wins: 0, losses: 0, voids: 0 };
  for (const row of rows) {
    if (row.result === 'win') record.wins = row.n;
    else if (row.result === 'loss') record.losses = row.n;
    else if (row.result === 'void') record.voids = row.n;
  }
  return record;
}
