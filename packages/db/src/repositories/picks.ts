/**
 * Pick repository helpers (WS0-T3). The full §6.2 pick algorithm (price stamping, clock
 * authority, counters) is WS3-T2 scope.
 */
import { and, eq } from 'drizzle-orm';
import type { Db } from '../client.js';
import { picks } from '../schema/index.js';

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
