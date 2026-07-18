/**
 * Ops dashboard queries (§15.5, WS10-T5): today's question timeline, the overdue-reveal
 * alert (§16.1: "question past reveal_at + 60 min unsettled"), and per-venue last successful
 * price update (a proxy for "last successful tick per venue" — there's no dedicated
 * per-venue timestamp table, so this reads the effect of a successful `venue:price-tick`
 * instead: the most recent `markets.yes_price_updated_at` per venue).
 */
import { and, eq, gte, lt, lte, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { questions } from '../schema/index.js';

export type QuestionTimelineRow = typeof questions.$inferSelect;

/** Questions opening within `[start, end)` — today's ET-day timeline. */
export async function listQuestionsForWindow(
  db: Db,
  start: Date,
  end: Date,
): Promise<QuestionTimelineRow[]> {
  return db
    .select()
    .from(questions)
    .where(and(gte(questions.openAt, start), lt(questions.openAt, end)))
    .orderBy(questions.openAt);
}

/** Locked questions whose reveal is overdue by more than `thresholdMinutes` (§16.1). */
export async function listOverdueRevealQuestions(
  db: Db,
  at: Date,
  thresholdMinutes: number,
): Promise<QuestionTimelineRow[]> {
  return db
    .select()
    .from(questions)
    .where(
      and(
        eq(questions.status, 'locked'),
        lte(questions.revealAt, sql`${at.toISOString()}::timestamptz - make_interval(mins => ${thresholdMinutes})`),
      ),
    )
    .orderBy(questions.revealAt);
}

export interface VenueLastPriceUpdate {
  venue: string;
  lastUpdatedAt: Date | null;
}

/** Most recent `yes_price_updated_at` per venue, across all markets. */
export async function getVenueLastPriceUpdate(db: Db): Promise<VenueLastPriceUpdate[]> {
  const res = await db.execute(sql`
    SELECT venue, max(yes_price_updated_at) AS last_updated_at
    FROM markets
    GROUP BY venue
  `);
  return res.rows.map((r) => ({
    venue: r['venue'] as string,
    lastUpdatedAt: r['last_updated_at'] ? new Date(r['last_updated_at'] as string) : null,
  }));
}
