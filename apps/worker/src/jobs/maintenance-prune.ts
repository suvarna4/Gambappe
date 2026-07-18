/**
 * `maintenance:prune` (WS0-T4 owns this; §11.5 data-lifecycle table + §5.6):
 *
 * 1. Ghost profiles unseen 13 months → anonymized (handle/slug → `expired-{full uuid}`,
 *    ghost_secret_hash nulled); their picks on still-open/scheduled questions are deleted
 *    with counter decrements; picks on revealed questions are KEPT with is_public=true
 *    (settled public history). Locked/voided-question picks are left untouched (the lock
 *    snapshot already consumed them).
 * 2. Price snapshots older than 90 days → deleted.
 * 3. analytics_events: ip_hash/ua_hash nulled after 7 days (§5.6); partitions wholly older
 *    than 13 months dropped (aggregate-only afterwards); partitions ensured for the current
 *    and next month.
 * 4. audit_log older than 24 months → deleted.
 *
 * All steps are idempotent and set-based; each runs in its own transaction so a partial
 * failure never leaves half-applied profile anonymization.
 */
import { sql } from 'drizzle-orm';
import {
  now,
  RETENTION_ANALYTICS_MONTHS,
  RETENTION_AUDIT_LOG_MONTHS,
  RETENTION_GHOST_UNSEEN_MONTHS,
  RETENTION_IP_UA_HASH_DAYS,
  RETENTION_PRICE_SNAPSHOTS_DAYS,
} from '@receipts/core';
import type { Db } from '@receipts/db';
import type { JobHandler } from '../heartbeat.js';
import { logger } from '../logger.js';

export interface PruneReport {
  ghostsAnonymized: number;
  openPicksDeleted: number;
  priceSnapshotsDeleted: number;
  ipUaHashesNulled: number;
  analyticsPartitionsDropped: string[];
  auditRowsDeleted: number;
}

/** Step 1: expire unseen ghosts (anonymize + delete their not-yet-locked picks). */
export async function pruneExpiredGhosts(
  db: Db,
  at: Date,
): Promise<{ ghostsAnonymized: number; openPicksDeleted: number }> {
  return db.transaction(async (tx) => {
    const cutoff = sql`${at.toISOString()}::timestamptz - make_interval(months => ${RETENTION_GHOST_UNSEEN_MONTHS})`;

    // Set-based selection of expiring ghosts (skip already-anonymized rows).
    const doomedProfiles = await tx.execute(sql`
      SELECT id FROM profiles
      WHERE kind = 'ghost'
        AND last_seen_at < ${cutoff}
        AND handle NOT LIKE 'expired-%'
    `);
    const ids = doomedProfiles.rows.map((r) => r['id'] as string);
    if (ids.length === 0) return { ghostsAnonymized: 0, openPicksDeleted: 0 };
    // drizzle serializes JS arrays as JSON — pass a PG array literal instead (uuids are safe).
    const idArray = `{${ids.join(',')}}`;

    // Delete picks on still-open/scheduled questions, decrementing live counters (§11.5).
    const deleted = await tx.execute(sql`
      WITH doomed AS (
        DELETE FROM picks p
        USING questions q
        WHERE p.question_id = q.id
          AND p.profile_id = ANY(${idArray}::uuid[])
          AND q.status IN ('open', 'scheduled')
        RETURNING p.question_id, p.side
      ),
      counts AS (
        SELECT question_id,
               count(*) FILTER (WHERE side = 'yes')::int AS yes_n,
               count(*) FILTER (WHERE side = 'no')::int AS no_n
        FROM doomed GROUP BY question_id
      )
      UPDATE questions q
      SET yes_count = q.yes_count - c.yes_n,
          no_count = q.no_count - c.no_n,
          updated_at = ${at.toISOString()}::timestamptz
      FROM counts c
      WHERE q.id = c.question_id
      RETURNING c.yes_n + c.no_n AS removed
    `);
    const openPicksDeleted = deleted.rows.reduce((acc, r) => acc + Number(r['removed'] ?? 0), 0);

    // Picks on revealed questions are kept public (§11.5) — assert the invariant cheaply.
    await tx.execute(sql`
      UPDATE picks SET is_public = true
      WHERE profile_id = ANY(${idArray}::uuid[])
        AND question_id IN (SELECT id FROM questions WHERE status = 'revealed')
        AND is_public = false
    `);

    // Anonymize: full-uuid handle/slug (collision-proof, §11.4 note), secret hash nulled.
    await tx.execute(sql`
      UPDATE profiles
      SET handle = 'expired-' || id::text,
          slug = 'expired-' || id::text,
          ghost_secret_hash = NULL,
          updated_at = ${at.toISOString()}::timestamptz
      WHERE id = ANY(${idArray}::uuid[])
    `);

    return { ghostsAnonymized: ids.length, openPicksDeleted };
  });
}

/** Step 2: price snapshot retention (§11.5: 90 days). */
export async function prunePriceSnapshots(db: Db, at: Date): Promise<number> {
  const res = await db.execute(sql`
    DELETE FROM market_price_snapshots
    WHERE ts < ${at.toISOString()}::timestamptz - make_interval(days => ${RETENTION_PRICE_SNAPSHOTS_DAYS})
  `);
  return res.rowCount ?? 0;
}

/** Step 3a: null ip/ua hashes older than 7 days (§5.6 — they exist only for bot heuristics). */
export async function pruneIpUaHashes(db: Db, at: Date): Promise<number> {
  const res = await db.execute(sql`
    UPDATE analytics_events
    SET ip_hash = NULL, ua_hash = NULL
    WHERE ts < ${at.toISOString()}::timestamptz - make_interval(days => ${RETENTION_IP_UA_HASH_DAYS})
      AND (ip_hash IS NOT NULL OR ua_hash IS NOT NULL)
  `);
  return res.rowCount ?? 0;
}

/** Step 3b: partition horizon — ensure current+next month exist, drop months > 13 back. */
export async function maintainAnalyticsPartitions(db: Db, at: Date): Promise<string[]> {
  await db.execute(sql`
    SELECT ensure_analytics_events_partition(date_trunc('month', ${at.toISOString()}::timestamptz)::date)
  `);
  await db.execute(sql`
    SELECT ensure_analytics_events_partition(
      (date_trunc('month', ${at.toISOString()}::timestamptz) + interval '1 month')::date
    )
  `);

  const dropped: string[] = [];
  const partitions = await db.execute(sql`
    SELECT inhrelid::regclass::text AS name
    FROM pg_inherits
    WHERE inhparent = 'analytics_events'::regclass
  `);
  for (const row of partitions.rows) {
    const name = row['name'] as string;
    const match = /analytics_events_(\d{4})_(\d{2})/.exec(name);
    if (!match) continue;
    const partStart = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
    const partEnd = new Date(Date.UTC(partStart.getUTCFullYear(), partStart.getUTCMonth() + 1, 1));
    const cutoff = new Date(at);
    cutoff.setUTCMonth(cutoff.getUTCMonth() - RETENTION_ANALYTICS_MONTHS);
    if (partEnd.getTime() <= cutoff.getTime()) {
      await db.execute(sql.raw(`DROP TABLE IF EXISTS ${name}`));
      dropped.push(name);
    }
  }
  return dropped;
}

/** Step 4: audit log retention (§11.5: 24 months). */
export async function pruneAuditLog(db: Db, at: Date): Promise<number> {
  const res = await db.execute(sql`
    DELETE FROM audit_log
    WHERE ts < ${at.toISOString()}::timestamptz - make_interval(months => ${RETENTION_AUDIT_LOG_MONTHS})
  `);
  return res.rowCount ?? 0;
}

export async function runMaintenancePrune(db: Db, at: Date = now()): Promise<PruneReport> {
  const ghosts = await pruneExpiredGhosts(db, at);
  const priceSnapshotsDeleted = await prunePriceSnapshots(db, at);
  const ipUaHashesNulled = await pruneIpUaHashes(db, at);
  const analyticsPartitionsDropped = await maintainAnalyticsPartitions(db, at);
  const auditRowsDeleted = await pruneAuditLog(db, at);
  return {
    ...ghosts,
    priceSnapshotsDeleted,
    ipUaHashesNulled,
    analyticsPartitionsDropped,
    auditRowsDeleted,
  };
}

export const maintenancePruneHandler: JobHandler = async (ctx) => {
  const report = await runMaintenancePrune(ctx.db);
  logger.info({ report }, 'maintenance:prune complete');
};
