/**
 * Question/market repository helpers (WS0-T3 + WS3-T1/T2/T4 additions). Lifecycle transitions
 * (§5.7 state machine) live here: every transition is a single guarded UPDATE ("idempotent:
 * transition functions check current state first; stale job = no-op", §5.7) so a re-delivered
 * pg-boss job or a duplicate admin action is always safe. The market browser/tagging queries
 * below are WS10-T2 (curation tooling, §15.2).
 */
import { and, asc, eq, gte, lte, sql } from 'drizzle-orm';
import { BOT_EXCLUDE_THRESHOLD } from '@receipts/core';
import type { Db } from '../client.js';
import { markets, questions } from '../schema/index.js';

export type MarketRow = typeof markets.$inferSelect;
export type NewMarketRow = typeof markets.$inferInsert;
export type QuestionRow = typeof questions.$inferSelect;
export type NewQuestionRow = typeof questions.$inferInsert;

export async function insertMarket(db: Db, row: NewMarketRow): Promise<MarketRow> {
  const [inserted] = await db.insert(markets).values(row).returning();
  if (!inserted) throw new Error('insertMarket: no row returned');
  return inserted;
}

export async function getMarketById(db: Db, id: string): Promise<MarketRow | null> {
  const [row] = await db.select().from(markets).where(eq(markets.id, id)).limit(1);
  return row ?? null;
}

export interface MarketFilters {
  venue?: string;
  category?: string;
  status?: string;
  closeBefore?: Date;
  closeAfter?: Date;
  minLiquidityUsd?: number;
}

/** Opaque cursor: the last row's (close_time, id) — the browser's own sort key (§15.2). */
export interface MarketCursor {
  closeTime: string;
  id: string;
}

/** Market browser (§15.2): searchable pool with filters, soonest-closing first. */
export async function listMarkets(
  db: Db,
  filters: MarketFilters,
  cursor: MarketCursor | null,
  limit: number,
): Promise<MarketRow[]> {
  const conditions = [];
  if (filters.venue) conditions.push(eq(markets.venue, filters.venue as MarketRow['venue']));
  if (filters.category) {
    conditions.push(eq(markets.category, filters.category as MarketRow['category']));
  }
  if (filters.status) conditions.push(eq(markets.status, filters.status as MarketRow['status']));
  if (filters.closeBefore) conditions.push(lte(markets.closeTime, filters.closeBefore));
  if (filters.closeAfter) conditions.push(gte(markets.closeTime, filters.closeAfter));
  if (filters.minLiquidityUsd != null) {
    conditions.push(gte(markets.liquidityUsd, filters.minLiquidityUsd));
  }
  if (cursor) {
    conditions.push(
      sql`(${markets.closeTime}, ${markets.id}) > (${cursor.closeTime}::timestamptz, ${cursor.id}::uuid)`,
    );
  }
  return db
    .select()
    .from(markets)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(markets.closeTime), asc(markets.id))
    .limit(limit);
}

/** Curation tag toggle (§15.2: "tag markets nemesis_eligible ... curate the duo_bonus pool" —
 * this one flag feeds both §8.8.1's nemesis bonus pool and duo_bonus question curation; the
 * schema has no separate column for the latter. */
export async function updateMarketNemesisEligible(
  db: Db,
  id: string,
  value: boolean,
): Promise<MarketRow | null> {
  const [row] = await db
    .update(markets)
    .set({ nemesisEligible: value, updatedAt: new Date() })
    .where(eq(markets.id, id))
    .returning();
  return row ?? null;
}

export async function insertQuestion(db: Db, row: NewQuestionRow): Promise<QuestionRow> {
  const [inserted] = await db.insert(questions).values(row).returning();
  if (!inserted) throw new Error('insertQuestion: no row returned');
  return inserted;
}

export async function getQuestionBySlug(db: Db, slug: string): Promise<QuestionRow | null> {
  const [row] = await db.select().from(questions).where(eq(questions.slug, slug)).limit(1);
  return row ?? null;
}

export async function getQuestionById(db: Db, id: string): Promise<QuestionRow | null> {
  const [row] = await db.select().from(questions).where(eq(questions.id, id)).limit(1);
  return row ?? null;
}

/** The daily question for a date (unique partial index guarantees ≤1). */
export async function getDailyQuestion(db: Db, questionDate: string): Promise<QuestionRow | null> {
  const [row] = await db
    .select()
    .from(questions)
    .where(and(eq(questions.kind, 'daily'), eq(questions.questionDate, questionDate)))
    .limit(1);
  return row ?? null;
}

/** Today's daily question by ET calendar date (§9.2 `GET /questions/today`). */
export async function getTodayDailyQuestion(db: Db, questionDateEt: string): Promise<QuestionRow | null> {
  return getDailyQuestion(db, questionDateEt);
}

// --- §5.7 state machine transitions ------------------------------------------------------------

export interface OpenQuestionResult {
  /** False when the question wasn't `scheduled` — stale/duplicate job, no-op (§5.7). */
  opened: boolean;
}

/** `question:open` (WS3-T1, §5.3): `scheduled` → `open`. Idempotent. */
export async function openQuestionTx(tx: Db, questionId: string, at: Date): Promise<OpenQuestionResult> {
  const res = await tx.execute(sql`
    UPDATE questions
    SET status = 'open', updated_at = ${at.toISOString()}::timestamptz
    WHERE id = ${questionId} AND status = 'scheduled'
    RETURNING id
  `);
  return { opened: (res.rowCount ?? 0) > 0 };
}

export interface LockSnapshotPrice {
  yesPrice: number;
}

export interface LockQuestionResult {
  /** False when the question wasn't `open` — stale/duplicate job, no-op (§5.7). */
  locked: boolean;
  crowdYesAtLock?: number;
  crowdNoAtLock?: number;
}

/**
 * `question:lock` (WS3-T1, §6.2 lock job): `open` → `locked`. `FOR UPDATE` on the question row
 * serializes against a concurrent pick's `SELECT ... FOR SHARE` (§6.2 step 5) — a pick can
 * never slip between this transition and the counter snapshot below, in either direction.
 * Crowd snapshot excludes picks from profiles with `bot_score >= BOT_EXCLUDE_THRESHOLD` at
 * snapshot time (§6.2: "same-day bot floods are filtered at the moment it matters"). `price` is
 * the already-resolved lock-time stamp (cache/DB ladder, §6.2 step 4 rules) or `null` if no
 * price was available — the transition still proceeds (a missing price snapshot never blocks
 * locking; it just leaves `yes_price_at_lock` null).
 */
export async function lockQuestionTx(
  tx: Db,
  questionId: string,
  at: Date,
  price: LockSnapshotPrice | null,
): Promise<LockQuestionResult> {
  const guard = await tx.execute(sql`
    SELECT status FROM questions WHERE id = ${questionId} FOR UPDATE
  `);
  const status = guard.rows[0]?.['status'];
  if (status !== 'open') return { locked: false };

  const crowd = await tx.execute(sql`
    SELECT
      count(*) FILTER (WHERE p.side = 'yes') AS yes_n,
      count(*) FILTER (WHERE p.side = 'no') AS no_n
    FROM picks p
    JOIN profiles pr ON pr.id = p.profile_id
    WHERE p.question_id = ${questionId} AND pr.bot_score < ${BOT_EXCLUDE_THRESHOLD}
  `);
  const crowdYesAtLock = Number(crowd.rows[0]?.['yes_n'] ?? 0);
  const crowdNoAtLock = Number(crowd.rows[0]?.['no_n'] ?? 0);

  await tx.execute(sql`
    UPDATE questions
    SET status = 'locked',
        crowd_yes_at_lock = ${crowdYesAtLock},
        crowd_no_at_lock = ${crowdNoAtLock},
        yes_price_at_lock = ${price ? price.yesPrice : null},
        updated_at = ${at.toISOString()}::timestamptz
    WHERE id = ${questionId}
  `);
  return { locked: true, crowdYesAtLock, crowdNoAtLock };
}

export interface RevealQuestionResult {
  /** False when not eligible (not `locked`, or not yet settled) — stale/duplicate job, no-op. */
  revealed: boolean;
}

/**
 * `reveal:fire` (WS3-T4, §6.7): `locked` → `revealed`. Guarded on `settled_at IS NOT NULL` so a
 * mis-scheduled/early re-arm can never reveal an ungraded question (defense in depth — the job
 * body itself also checks settlement before calling this).
 */
export async function revealQuestionTx(tx: Db, questionId: string, at: Date): Promise<RevealQuestionResult> {
  const res = await tx.execute(sql`
    UPDATE questions
    SET status = 'revealed', revealed_at = ${at.toISOString()}::timestamptz, updated_at = ${at.toISOString()}::timestamptz
    WHERE id = ${questionId} AND status = 'locked' AND settled_at IS NOT NULL
    RETURNING id
  `);
  return { revealed: (res.rowCount ?? 0) > 0 };
}

/**
 * Post-reveal admin void (§5.7: `revealed` → `voided`, within `REGRADE_WINDOW_H`) — included
 * here for completeness of the state machine; WS10-T3 (admin overrides) is the actual caller.
 * Not exercised by WS3; picks/streak replay for this path are that task's responsibility.
 */
export async function voidRevealedQuestionTx(
  tx: Db,
  questionId: string,
  at: Date,
  voidReason: string,
): Promise<{ voided: boolean }> {
  const res = await tx.execute(sql`
    UPDATE questions
    SET status = 'voided', void_reason = ${voidReason}, updated_at = ${at.toISOString()}::timestamptz
    WHERE id = ${questionId} AND status = 'revealed'
    RETURNING id
  `);
  return { voided: (res.rowCount ?? 0) > 0 };
}

/** Daily questions in `[from, to]` (inclusive) that have settled into revealed/voided history — the
 * §6.6 replay/gap-rule input set. Ordered by `question_date`. */
export async function listRevealedOrVoidedDailyBetween(
  db: Db,
  from: string,
  to: string,
): Promise<Array<{ id: string; questionDate: string; status: 'revealed' | 'voided' }>> {
  const rows = await db.execute(sql`
    SELECT id, question_date, status
    FROM questions
    WHERE kind = 'daily' AND status IN ('revealed', 'voided')
      AND question_date >= ${from} AND question_date <= ${to}
    ORDER BY question_date ASC
  `);
  return rows.rows.map((r) => ({
    id: r['id'] as string,
    questionDate: r['question_date'] as string,
    status: r['status'] as 'revealed' | 'voided',
  }));
}

/** All revealed/voided daily questions up to and including `throughDate` — the §6.6 full-replay
 * input set (unbounded lower bound, matching the WS2-T3 merge precedent). */
export async function listRevealedOrVoidedDailyThrough(
  db: Db,
  throughDate: string,
): Promise<Array<{ id: string; questionDate: string; status: 'revealed' | 'voided' }>> {
  return listRevealedOrVoidedDailyBetween(db, '0001-01-01', throughDate);
}

/** The daily question for the calendar day immediately before `questionDate`, if one exists —
 * used to assert the §6.6 structural reveal-ordering guarantee before `reveal:fire` proceeds. */
export async function getPriorDayDailyQuestion(
  db: Db,
  questionDate: string,
): Promise<{ status: QuestionRow['status'] } | null> {
  const rows = await db.execute(sql`
    SELECT status
    FROM questions
    WHERE kind = 'daily' AND question_date = (${questionDate}::date - INTERVAL '1 day')::date
    LIMIT 1
  `);
  const row = rows.rows[0];
  return row ? { status: row['status'] as QuestionRow['status'] } : null;
}

/** The single latest daily question_date that has settled into revealed/voided history, if any. */
export async function getLatestRevealedOrVoidedDailyDate(db: Db): Promise<string | null> {
  const rows = await db.execute(sql`
    SELECT max(question_date) AS d FROM questions WHERE kind = 'daily' AND status IN ('revealed', 'voided')
  `);
  return (rows.rows[0]?.['d'] as string | null) ?? null;
}

/** Daily `question_date`s in `[from, to]` (any status) — used by the freeze-earn 7-day window (§6.6). */
export async function listDailyDatesBetween(db: Db, from: string, to: string): Promise<string[]> {
  const rows = await db.execute(sql`
    SELECT question_date
    FROM questions
    WHERE kind = 'daily' AND question_date >= ${from} AND question_date <= ${to}
    ORDER BY question_date ASC
  `);
  return rows.rows.map((r) => r['question_date'] as string);
}

/** Daily question ids in `[from, to]` (any status) — §6.6 freeze-earn eligibility counts picks
 * against these ids (regardless of whether they've settled yet at grant time). */
export async function listDailyQuestionIdsBetween(db: Db, from: string, to: string): Promise<string[]> {
  const rows = await db.execute(sql`
    SELECT id
    FROM questions
    WHERE kind = 'daily' AND question_date >= ${from} AND question_date <= ${to}
    ORDER BY question_date ASC
  `);
  return rows.rows.map((r) => r['id'] as string);
}

/**
 * `question:open` questions whose `lock_at` is still ahead of `at` but within `leadMinutes` —
 * the `notify:pre-lock-reminder` (WS9-T4, §13.2) eligibility window. Effective-state rule
 * (§5.7): this reads `status='open'` directly (not derived from timestamps) so a question whose
 * lock job has already flipped it to `locked` is correctly excluded even if `lock_at` itself is
 * still numerically inside the window (a late-running lock job racing this job is not this
 * query's problem to solve — worst case the reminder is skipped for that tick, and dedupe means
 * a skipped tick is never a double-send risk in the other direction either). Ordered by
 * `lock_at` so the soonest-to-lock question is processed first.
 */
export async function listOpenQuestionsWithLockWithin(
  db: Db,
  at: Date,
  leadMinutes: number,
): Promise<QuestionRow[]> {
  return db
    .select()
    .from(questions)
    .where(
      and(
        eq(questions.status, 'open'),
        gte(questions.lockAt, at),
        lte(questions.lockAt, new Date(at.getTime() + leadMinutes * 60_000)),
      ),
    )
    .orderBy(asc(questions.lockAt));
}
