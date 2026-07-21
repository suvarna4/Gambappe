/**
 * `settle:digest` (WS19-T1, D-J3; 21:00 ET daily): the anti-spam companion to the per-settle
 * push (`../lib/settle-question.ts`). Settlement now follows the venue market's own resolution
 * clock (any time of day), so a busy day can settle several of a profile's open positions — the
 * per-settle push fires only for the FIRST settle of a profile's ET day, and THIS job sweeps the
 * rest into one summary push at 21:00 ET: "you had N receipts grade today".
 *
 * A "settle" for a profile = a non-void graded pick on a `daily` question that revealed inside
 * today's ET window. A profile with ≥2 such settles gets exactly one digest push; the
 * `reveal_settle_digest:{etDate}:{profileId}` dedupe key makes a redelivery a silent no-op. Kind
 * `reveal_digest` (reveal_* → 'reveal' category, §9.4) so it dispatches on the same `push_reveal`
 * opt-in the per-settle push uses. Profiles with 0 or 1 settle get nothing here — the single
 * settle they had was already pushed live.
 */
import { sql } from 'drizzle-orm';
import { now } from '@receipts/core';
import { sendNotification, type Db } from '@receipts/db';
import type { JobHandler } from '../heartbeat.js';
import { logger } from '../logger.js';
import { etDateString, etDayWindow } from '../lib/day-window.js';

/** Minimum settles in a profile's ET day for the digest to fire (below this, the one settle was
 * already pushed live by `settleQuestion`). */
const DIGEST_MIN_SETTLES = 2;

export interface SettleDigestReport {
  etDate: string;
  /** profiles with ≥ DIGEST_MIN_SETTLES settles today. */
  eligible: number;
  /** digest pushes actually inserted (deduped redeliveries excluded). */
  pushed: number;
}

/** Digest push copy (D-J3). */
export function settleDigestLine(count: number): string {
  return `⚡ ${count} of your receipts graded today — see how the day landed.`;
}

export async function runSettleDigest(db: Db, at: Date = now()): Promise<SettleDigestReport> {
  const etDate = etDateString(at);
  const { start, end } = etDayWindow(etDate);

  // Settles-per-profile for today's ET window: non-void graded picks on daily questions that
  // revealed today. GROUP BY profile, keep those at/over the digest floor.
  const rows = await db.execute(sql`
    SELECT p.profile_id AS profile_id, COUNT(*) AS settles
    FROM picks p
    JOIN questions q ON q.id = p.question_id
    WHERE q.kind = 'daily'
      AND q.status = 'revealed'
      AND q.revealed_at >= ${start.toISOString()}::timestamptz
      AND q.revealed_at < ${end.toISOString()}::timestamptz
      AND p.result <> 'void'
    GROUP BY p.profile_id
    HAVING COUNT(*) >= ${DIGEST_MIN_SETTLES}
  `);

  const report: SettleDigestReport = { etDate, eligible: rows.rows.length, pushed: 0 };
  for (const row of rows.rows) {
    const profileId = row['profile_id'] as string;
    const count = Number(row['settles']);
    const result = await sendNotification(
      db,
      profileId,
      'reveal_digest',
      { line: settleDigestLine(count), ctaUrl: '/', ctaLabel: 'See your day' },
      'push',
      `reveal_settle_digest:${etDate}:${profileId}`,
      at,
    );
    if (result.inserted) report.pushed += 1;
  }
  return report;
}

export const settleDigestHandler: JobHandler = async (ctx) => {
  const report = await runSettleDigest(ctx.db);
  logger.info({ report }, 'settle:digest complete');
};
