/**
 * `metric_rollups` repository (§16.3, WS13-T2): written nightly by `analytics:rollup`, read
 * by the admin metrics page (WS13-T3).
 */
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import type { Db } from '../client.js';
import { metricRollups } from '../schema/index.js';

export type MetricRollupRow = typeof metricRollups.$inferSelect;

export interface MetricRollupInput {
  metric: string;
  value: number;
  dims?: Record<string, unknown>;
}

/**
 * Idempotent nightly write: a rerun for the same date must reproduce the same rows, not
 * append duplicates alongside stale ones. A metric can have several `dims` rows per date
 * (e.g. one per nemesis trigger), so there's no single-row key to `ON CONFLICT` against —
 * delete-then-insert the whole date in one transaction instead.
 */
export async function replaceMetricRollupsForDate(
  db: Db,
  date: string,
  rows: MetricRollupInput[],
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(metricRollups).where(eq(metricRollups.date, date));
    if (rows.length === 0) return;
    await tx.insert(metricRollups).values(
      rows.map((r) => ({ date, metric: r.metric, value: r.value, dims: r.dims ?? {} })),
    );
  });
}

export async function listMetricRollups(
  db: Db,
  date: string,
  metric?: string,
): Promise<MetricRollupRow[]> {
  const conditions = [eq(metricRollups.date, date)];
  if (metric) conditions.push(eq(metricRollups.metric, metric));
  return db
    .select()
    .from(metricRollups)
    .where(and(...conditions));
}

/** All rows with `date` in `[startDate, endDate]` inclusive, ordered by date (§13.1 metrics page). */
export async function listMetricRollupsForRange(
  db: Db,
  startDate: string,
  endDate: string,
): Promise<MetricRollupRow[]> {
  return db
    .select()
    .from(metricRollups)
    .where(and(gte(metricRollups.date, startDate), lte(metricRollups.date, endDate)))
    .orderBy(asc(metricRollups.date));
}
