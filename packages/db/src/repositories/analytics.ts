/**
 * analytics_events repository (§5.6, §13.1, WS13-T1). The table is monthly-partitioned by
 * `ts` from day one (see drizzle/0001_init.sql); inserts must always carry `ts` so Postgres
 * routes the row to the right partition — a missing/mismatched `ts` fails at the DB layer
 * rather than silently landing in the wrong partition.
 */
import { analyticsEvents } from '../schema/index.js';
import type { Db } from '../client.js';

export type AnalyticsEventRow = typeof analyticsEvents.$inferSelect;
export type NewAnalyticsEventRow = typeof analyticsEvents.$inferInsert;

export async function insertAnalyticsEvent(
  db: Db,
  row: NewAnalyticsEventRow,
): Promise<AnalyticsEventRow> {
  const [inserted] = await db.insert(analyticsEvents).values(row).returning();
  if (!inserted) throw new Error('insertAnalyticsEvent: no row returned');
  return inserted;
}
