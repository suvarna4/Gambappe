/**
 * `analytics:rollup` (WS13-T2 owns this; §16.3): daily 04:00 ET job finalizing metrics for
 * the ET calendar day that just completed, writing one or more `metric_rollups` rows per
 * metric (`dims` distinguishes sub-rows, e.g. per claim-prompt trigger).
 *
 * Every function below is pure given `(db, window)` — no wall-clock reads except in the
 * exported handler, which resolves "yesterday" once at entry — so the whole computation is
 * independently testable against fixture rows with an explicit date, per §17.2.
 *
 * Two metrics rely on identifying an "actor" across the ghost→claimed lifecycle:
 * `COALESCE(profile_id::text, anon_id)`. A profile row is created at `ghost_minted` and its
 * id is stable through claim (§5.2, DD-4), so `profile_id` alone correctly links pre- and
 * post-claim activity once a ghost exists; `anon_id` only covers the pre-ghost spectator.
 *
 * `reveal_attendance_rate` assumes the (not-yet-implemented, WS3-T4/WS9-owned) emitter of
 * `reveal_attended` stamps `props.question_id` — the natural join key, matching how every
 * other per-question client event is expected to be shaped (§13.1 doesn't pin this down
 * further since the emitting workstream hasn't shipped yet).
 */
import { sql } from 'drizzle-orm';
import { BOT_EXCLUDE_THRESHOLD, now, REVEAL_ATTENDANCE_WINDOW_H } from '@receipts/core';
import { replaceMetricRollupsForDate, type Db, type MetricRollupInput } from '@receipts/db';
import type { JobHandler } from '../heartbeat.js';
import { logger } from '../logger.js';
import { addDaysToDateStr, etDateString, etDayWindow, mostRecentMonday, trailingWindow, type DateWindow } from '../lib/day-window.js';

function iso(d: Date): string {
  return d.toISOString();
}

async function activationRate(db: Db, w: DateWindow): Promise<number> {
  const res = await db.execute(sql`
    WITH viewers AS (
      SELECT DISTINCT COALESCE(profile_id::text, anon_id) AS actor
      FROM analytics_events
      WHERE event = 'spectator_view' AND ts >= ${iso(w.start)}::timestamptz AND ts < ${iso(w.end)}::timestamptz
        AND COALESCE(profile_id::text, anon_id) IS NOT NULL
    ),
    pickers AS (
      SELECT DISTINCT COALESCE(profile_id::text, anon_id) AS actor
      FROM analytics_events
      WHERE event = 'pick_created' AND ts >= ${iso(w.start)}::timestamptz AND ts < ${iso(w.end)}::timestamptz
        AND COALESCE(profile_id::text, anon_id) IS NOT NULL
    )
    SELECT
      (SELECT count(*) FROM viewers)::int AS viewers_n,
      (SELECT count(*) FROM pickers p WHERE p.actor IN (SELECT actor FROM viewers))::int AS activated_n
  `);
  const row = res.rows[0] as { viewers_n: number; activated_n: number };
  return row.viewers_n > 0 ? row.activated_n / row.viewers_n : 0;
}

async function ghostClaimConversionByTrigger(db: Db, w: DateWindow): Promise<MetricRollupInput[]> {
  const res = await db.execute(sql`
    WITH shown AS (
      SELECT profile_id, COALESCE(props->>'trigger', 'unknown') AS trigger
      FROM analytics_events
      WHERE event = 'claim_prompt_shown' AND ts >= ${iso(w.start)}::timestamptz AND ts < ${iso(w.end)}::timestamptz
        AND profile_id IS NOT NULL
    ),
    completed AS (
      SELECT DISTINCT profile_id
      FROM analytics_events
      WHERE event = 'claim_completed' AND ts >= ${iso(w.start)}::timestamptz AND ts < ${iso(w.end)}::timestamptz
        AND profile_id IS NOT NULL
    )
    SELECT trigger,
           count(DISTINCT profile_id)::int AS shown_n,
           count(DISTINCT profile_id) FILTER (WHERE profile_id IN (SELECT profile_id FROM completed))::int AS completed_n
    FROM shown
    GROUP BY trigger
  `);
  return res.rows.map((r) => {
    const row = r as { trigger: string; shown_n: number; completed_n: number };
    return {
      metric: 'ghost_claim_conversion',
      value: row.shown_n > 0 ? row.completed_n / row.shown_n : 0,
      dims: { trigger: row.trigger },
    };
  });
}

async function activeActorCount(db: Db, w: DateWindow): Promise<number> {
  const res = await db.execute(sql`
    SELECT count(DISTINCT COALESCE(profile_id::text, anon_id))::int AS n
    FROM analytics_events
    WHERE ts >= ${iso(w.start)}::timestamptz AND ts < ${iso(w.end)}::timestamptz
      AND COALESCE(profile_id::text, anon_id) IS NOT NULL
  `);
  return Number((res.rows[0] as { n: number }).n);
}

async function dailyAnswerRate(db: Db, dateStr: string, w: DateWindow): Promise<MetricRollupInput | null> {
  const qRes = await db.execute(sql`
    SELECT id FROM questions WHERE kind = 'daily' AND question_date = ${dateStr}::date LIMIT 1
  `);
  const questionId = qRes.rows[0]?.['id'] as string | undefined;
  if (!questionId) return null;

  const res = await db.execute(sql`
    WITH active_claimed AS (
      SELECT DISTINCT ae.profile_id
      FROM analytics_events ae
      JOIN profiles pr ON pr.id = ae.profile_id
      WHERE ae.ts >= ${iso(w.start)}::timestamptz AND ae.ts < ${iso(w.end)}::timestamptz
        AND pr.kind = 'claimed'
    ),
    answered AS (
      SELECT DISTINCT p.profile_id
      FROM picks p
      JOIN profiles pr ON pr.id = p.profile_id
      WHERE p.question_id = ${questionId}::uuid AND pr.kind = 'claimed'
    )
    SELECT
      (SELECT count(*) FROM active_claimed)::int AS active_n,
      (SELECT count(*) FROM answered a WHERE a.profile_id IN (SELECT profile_id FROM active_claimed))::int AS answered_n
  `);
  const row = res.rows[0] as { active_n: number; answered_n: number };
  return {
    metric: 'daily_answer_rate',
    value: row.active_n > 0 ? row.answered_n / row.active_n : 0,
    dims: { question_id: questionId },
  };
}

async function revealAttendanceRate(db: Db, w: DateWindow): Promise<number | null> {
  const res = await db.execute(sql`
    WITH revealed_qs AS (
      SELECT id, reveal_at FROM questions
      WHERE status = 'revealed' AND revealed_at >= ${iso(w.start)}::timestamptz AND revealed_at < ${iso(w.end)}::timestamptz
    ),
    pick_counts AS (
      SELECT q.id AS question_id, count(p.*)::int AS n
      FROM revealed_qs q LEFT JOIN picks p ON p.question_id = q.id
      GROUP BY q.id
    ),
    attended AS (
      SELECT q.id AS question_id, count(DISTINCT ae.profile_id)::int AS n
      FROM revealed_qs q
      JOIN analytics_events ae
        ON ae.props->>'question_id' = q.id::text
        AND ae.event = 'reveal_attended'
        AND ae.ts >= q.reveal_at
        AND ae.ts < q.reveal_at + make_interval(hours => ${REVEAL_ATTENDANCE_WINDOW_H})
      GROUP BY q.id
    )
    SELECT
      COALESCE((SELECT sum(n) FROM pick_counts), 0)::int AS total_picks,
      COALESCE((SELECT sum(n) FROM attended), 0)::int AS total_attended
  `);
  const row = res.rows[0] as { total_picks: number; total_attended: number };
  return row.total_picks > 0 ? row.total_attended / row.total_picks : null;
}

async function eventCount(db: Db, w: DateWindow, events: string[]): Promise<number> {
  // drizzle's sql`` serializes a JS array as JSON, not a PG array literal (same pitfall as
  // maintenance-prune.ts's idArray) — build the `{a,b}` literal by hand instead.
  const eventArray = `{${events.join(',')}}`;
  const res = await db.execute(sql`
    SELECT count(*)::int AS n FROM analytics_events
    WHERE event = ANY(${eventArray}::text[]) AND ts >= ${iso(w.start)}::timestamptz AND ts < ${iso(w.end)}::timestamptz
  `);
  return Number((res.rows[0] as { n: number }).n);
}

async function kFactorChain(db: Db, w: DateWindow): Promise<MetricRollupInput[]> {
  const res = await db.execute(sql`
    SELECT
      count(*) FILTER (WHERE event = 'share_completed')::int AS share_completed_n,
      count(*) FILTER (WHERE event = 'spectator_view' AND props->>'source' = 'share_card')::int AS spectator_view_share_n,
      count(*) FILTER (WHERE event = 'ghost_minted')::int AS ghost_minted_n,
      count(*) FILTER (WHERE event = 'claim_completed')::int AS claim_completed_n
    FROM analytics_events
    WHERE ts >= ${iso(w.start)}::timestamptz AND ts < ${iso(w.end)}::timestamptz
  `);
  const row = res.rows[0] as Record<string, number>;
  return [
    { metric: 'k_factor_chain', value: row['share_completed_n']!, dims: { stage: 'share_completed' } },
    { metric: 'k_factor_chain', value: row['spectator_view_share_n']!, dims: { stage: 'spectator_view_share' } },
    { metric: 'k_factor_chain', value: row['ghost_minted_n']!, dims: { stage: 'ghost_minted' } },
    { metric: 'k_factor_chain', value: row['claim_completed_n']!, dims: { stage: 'claim_completed' } },
  ];
}

async function nemesisCompletionRate(db: Db, weekStart: string): Promise<MetricRollupInput | null> {
  const res = await db.execute(sql`
    SELECT count(*)::int AS total_n, count(*) FILTER (WHERE status = 'completed')::int AS completed_n
    FROM nemesis_pairings WHERE week_start = ${weekStart}::date
  `);
  const row = res.rows[0] as { total_n: number; completed_n: number };
  if (row.total_n === 0) return null;
  return { metric: 'nemesis_completion_rate', value: row.completed_n / row.total_n, dims: { week_start: weekStart } };
}

async function duoQueueDepth(db: Db): Promise<number> {
  const res = await db.execute(sql`SELECT count(*)::int AS n FROM duo_queue_entries WHERE status = 'waiting'`);
  return Number((res.rows[0] as { n: number }).n);
}

async function duoRematchRate(db: Db, w: DateWindow): Promise<number | null> {
  const res = await db.execute(sql`
    SELECT count(*)::int AS total_n, count(*) FILTER (WHERE status = 'accepted')::int AS accepted_n
    FROM rematch_requests
    WHERE created_at >= ${iso(w.start)}::timestamptz AND created_at < ${iso(w.end)}::timestamptz
  `);
  const row = res.rows[0] as { total_n: number; accepted_n: number };
  return row.total_n > 0 ? row.accepted_n / row.total_n : null;
}

async function botFlagRate(db: Db): Promise<number> {
  const res = await db.execute(sql`
    SELECT count(*)::int AS total_n, count(*) FILTER (WHERE bot_score >= ${BOT_EXCLUDE_THRESHOLD})::int AS flagged_n
    FROM profiles
  `);
  const row = res.rows[0] as { total_n: number; flagged_n: number };
  return row.total_n > 0 ? row.flagged_n / row.total_n : 0;
}

/** Assembles every §16.3 metric row for `dateStr` (an ET calendar date, YYYY-MM-DD). */
export async function computeAnalyticsRollups(db: Db, dateStr: string): Promise<MetricRollupInput[]> {
  const dayWindow = etDayWindow(dateStr);
  const weekWindow = trailingWindow(dateStr, 7);
  const weekStart = mostRecentMonday(dateStr);
  const rows: MetricRollupInput[] = [];

  rows.push({ metric: 'activation_rate', value: await activationRate(db, dayWindow), dims: {} });
  rows.push(...(await ghostClaimConversionByTrigger(db, dayWindow)));

  const dau = await activeActorCount(db, dayWindow);
  rows.push({ metric: 'dau', value: dau, dims: {} });
  const wau = await activeActorCount(db, weekWindow);
  rows.push({ metric: 'wau', value: wau, dims: { window: '7d' } });

  const answerRate = await dailyAnswerRate(db, dateStr, dayWindow);
  if (answerRate) rows.push(answerRate);

  const attendance = await revealAttendanceRate(db, dayWindow);
  if (attendance !== null) rows.push({ metric: 'reveal_attendance_rate', value: attendance, dims: {} });

  const cardsGenerated = await eventCount(db, weekWindow, ['share_card_generated']);
  rows.push({ metric: 'cards_per_user_week', value: wau > 0 ? cardsGenerated / wau : 0, dims: { window: '7d' } });

  rows.push(...(await kFactorChain(db, dayWindow)));

  const nemesis = await nemesisCompletionRate(db, weekStart);
  if (nemesis) rows.push(nemesis);

  rows.push({ metric: 'duo_queue_depth', value: await duoQueueDepth(db), dims: {} });

  const rematch = await duoRematchRate(db, weekWindow);
  if (rematch !== null) rows.push({ metric: 'duo_rematch_rate', value: rematch, dims: { window: '7d' } });

  rows.push({ metric: 'chemistry_stat_views', value: await eventCount(db, dayWindow, ['chemistry_viewed', 'duo_page_viewed']), dims: {} });

  const blocked = await eventCount(db, dayWindow, ['block_created']);
  rows.push({ metric: 'block_rate', value: dau > 0 ? blocked / dau : 0, dims: {} });
  const reported = await eventCount(db, dayWindow, ['report_filed']);
  rows.push({ metric: 'report_rate', value: dau > 0 ? reported / dau : 0, dims: {} });

  rows.push({ metric: 'bot_flag_rate', value: await botFlagRate(db), dims: {} });

  return rows;
}

export const analyticsRollupHandler: JobHandler = async (ctx) => {
  const dateStr = addDaysToDateStr(etDateString(now()), -1); // finalize the ET day that just completed
  const rows = await computeAnalyticsRollups(ctx.db, dateStr);
  await replaceMetricRollupsForDate(ctx.db, dateStr, rows);
  logger.info({ date: dateStr, metrics: rows.length }, 'analytics:rollup complete');
};
