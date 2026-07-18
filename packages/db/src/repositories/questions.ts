/**
 * Question/market repository helpers (WS0-T3). Lifecycle jobs are WS3 scope; the market
 * browser/tagging queries below are WS10-T2 (curation tooling, §15.2).
 */
import { and, asc, eq, gte, lte, sql } from 'drizzle-orm';
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

/** The daily question for a date (unique partial index guarantees ≤1). */
export async function getDailyQuestion(db: Db, questionDate: string): Promise<QuestionRow | null> {
  const [row] = await db
    .select()
    .from(questions)
    .where(and(eq(questions.kind, 'daily'), eq(questions.questionDate, questionDate)))
    .limit(1);
  return row ?? null;
}
