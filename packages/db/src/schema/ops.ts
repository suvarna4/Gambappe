/**
 * Ops tables: job_heartbeats (§15.5) + metric_rollups (§16.3). Included in `0001_init`
 * with the rest of the schema per the §4.5 policy (0001 creates everything, including tables
 * owned by later workstreams).
 */
import { bigserial, date, doublePrecision, index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/** `job_heartbeats` — last run/success per job, read by the ops dashboard (§15.5, §16.1). */
export const jobHeartbeats = pgTable('job_heartbeats', {
  jobName: text('job_name').primaryKey(),
  lastStartedAt: timestamp('last_started_at', { withTimezone: true }),
  lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
  lastErrorAt: timestamp('last_error_at', { withTimezone: true }),
  /** Message only — never payload data (§16.2 logging rules). */
  lastError: text('last_error'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * `metric_rollups` (§16.3): `date, metric, value, dims jsonb`, written by `analytics:rollup`
 * (WS13-T2). Surrogate id + unique-ish (date, metric) index because dims produce multiple
 * rows per metric-date.
 */
export const metricRollups = pgTable(
  'metric_rollups',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    date: date('date').notNull(),
    metric: text('metric').notNull(),
    value: doublePrecision('value').notNull(),
    dims: jsonb('dims').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('metric_rollups_date_metric_idx').on(t.date, t.metric)],
);
