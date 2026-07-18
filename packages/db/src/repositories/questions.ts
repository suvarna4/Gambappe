/**
 * Question/market repository helpers (WS0-T3). Lifecycle jobs are WS3 scope.
 */
import { and, eq } from 'drizzle-orm';
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
