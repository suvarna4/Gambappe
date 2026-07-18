/**
 * `bot:score` (WS11-T2 owns this; §14.2, "best-effort, deliberately not paranoid"): nightly
 * heuristic updating `profiles.bot_score` from four signals — pick latency uniformity
 * (sub-second picks across days), IP-hash fan-out (many profiles sharing an ip_hash/day),
 * 24/7 activity spread, and UA-hash churn. Score ≥ `BOT_EXCLUDE_THRESHOLD` (0.8) already
 * drives leaderboard/matchmaking exclusion via existing `bot_score` filters elsewhere in the
 * schema (e.g. `profiles_bot_score_idx`, the lock-snapshot crowd-count exclusion, §6.2) —
 * this job's only job is to keep that column honest.
 *
 * Every signal is normalized to a [0,1] "suspicion" sub-score and combined by simple
 * unweighted average (`combineBotScore`, pure — no DB, easy to fixture-test in isolation).
 * Absent a more specific spec for weighting or thresholds, equal weights are the smallest
 * defensible choice; a profile with too little data for a signal contributes 0 (neutral, not
 * suspicious) for that signal rather than skewing the average from a single data point.
 */
import { sql } from 'drizzle-orm';
import { BOT_EXCLUDE_THRESHOLD } from '@receipts/core';
import { updateProfileBotScores, type Db } from '@receipts/db';
import type { JobHandler } from '../heartbeat.js';
import { logger } from '../logger.js';

/** Lookback window for every signal — enough nights to see a pattern, not so many that a
 * profile's bot_score reacts to activity from a month ago. */
export const BOT_SCORE_LOOKBACK_DAYS = 14;

// "Sub-second and uniform": both factors must hold for the latency signal to fire hard.
const LATENCY_FAST_CEILING_MS = 1000;
const LATENCY_UNIFORM_STDDEV_CEILING_MS = 300;
const LATENCY_MIN_PICKS = 5;

// Fan-out: how many distinct profiles shared this profile's (ip_hash, day) at the worst point.
const FANOUT_SUSPICIOUS_N = 10;

// 24/7 spread: distinct ET hours-of-day touched; humans cluster into fewer hours.
const SPREAD_HUMAN_MAX_HOURS = 16;
const SPREAD_MIN_ACTIVE_DAYS = 3;

// UA churn: distinct ua_hash values seen for one profile.
const UA_CHURN_SUSPICIOUS_N = 5;

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

export interface BotSignals {
  latencyMeanMs: number | null;
  latencyStdDevMs: number | null;
  maxIpFanout: number | null;
  distinctActiveHours: number | null;
  distinctUaHashes: number | null;
}

/** Pure: turns raw per-profile signals into a single [0,1] bot_score. */
export function combineBotScore(signals: BotSignals): number {
  const latency =
    signals.latencyMeanMs !== null && signals.latencyStdDevMs !== null
      ? clamp01(1 - signals.latencyMeanMs / LATENCY_FAST_CEILING_MS) *
        clamp01(1 - signals.latencyStdDevMs / LATENCY_UNIFORM_STDDEV_CEILING_MS)
      : 0;

  const fanout =
    signals.maxIpFanout !== null
      ? clamp01((signals.maxIpFanout - 1) / (FANOUT_SUSPICIOUS_N - 1))
      : 0;

  const spread =
    signals.distinctActiveHours !== null
      ? clamp01((signals.distinctActiveHours - SPREAD_HUMAN_MAX_HOURS) / (24 - SPREAD_HUMAN_MAX_HOURS))
      : 0;

  const uaChurn =
    signals.distinctUaHashes !== null
      ? clamp01((signals.distinctUaHashes - 1) / (UA_CHURN_SUSPICIOUS_N - 1))
      : 0;

  return clamp01((latency + fanout + spread + uaChurn) / 4);
}

async function queryLatencySignals(db: Db, since: Date): Promise<Map<string, { meanMs: number; stdDevMs: number }>> {
  const res = await db.execute(sql`
    SELECT
      profile_id,
      avg(latency_ms) AS mean_ms,
      coalesce(stddev_pop(latency_ms), 0) AS stddev_ms
    FROM (
      SELECT profile_id, extract(epoch FROM (picked_at - price_stamped_at)) * 1000 AS latency_ms
      FROM picks
      WHERE picked_at >= ${since.toISOString()}::timestamptz
    ) latencies
    GROUP BY profile_id
    HAVING count(*) >= ${LATENCY_MIN_PICKS}
  `);
  const map = new Map<string, { meanMs: number; stdDevMs: number }>();
  for (const row of res.rows) {
    map.set(row['profile_id'] as string, {
      meanMs: Number(row['mean_ms']),
      stdDevMs: Number(row['stddev_ms']),
    });
  }
  return map;
}

async function queryFanoutSignals(db: Db, since: Date): Promise<Map<string, number>> {
  const res = await db.execute(sql`
    WITH daily_ip AS (
      SELECT DISTINCT profile_id, ip_hash, date_trunc('day', ts) AS day
      FROM analytics_events
      WHERE ts >= ${since.toISOString()}::timestamptz AND profile_id IS NOT NULL AND ip_hash IS NOT NULL
    ),
    fanout_per_bucket AS (
      SELECT ip_hash, day, count(DISTINCT profile_id) AS n
      FROM daily_ip
      GROUP BY ip_hash, day
    )
    SELECT di.profile_id, max(f.n) AS max_fanout
    FROM daily_ip di
    JOIN fanout_per_bucket f ON f.ip_hash = di.ip_hash AND f.day = di.day
    GROUP BY di.profile_id
  `);
  const map = new Map<string, number>();
  for (const row of res.rows) map.set(row['profile_id'] as string, Number(row['max_fanout']));
  return map;
}

async function querySpreadSignals(db: Db, since: Date): Promise<Map<string, number>> {
  const res = await db.execute(sql`
    SELECT profile_id, count(DISTINCT hour) AS distinct_hours
    FROM (
      SELECT profile_id,
             extract(hour FROM ts AT TIME ZONE 'America/New_York') AS hour,
             date_trunc('day', ts AT TIME ZONE 'America/New_York') AS day
      FROM analytics_events
      WHERE ts >= ${since.toISOString()}::timestamptz AND profile_id IS NOT NULL
    ) hours
    GROUP BY profile_id
    HAVING count(DISTINCT day) >= ${SPREAD_MIN_ACTIVE_DAYS}
  `);
  const map = new Map<string, number>();
  for (const row of res.rows) map.set(row['profile_id'] as string, Number(row['distinct_hours']));
  return map;
}

async function queryUaChurnSignals(db: Db, since: Date): Promise<Map<string, number>> {
  const res = await db.execute(sql`
    SELECT profile_id, count(DISTINCT ua_hash) AS distinct_ua
    FROM analytics_events
    WHERE ts >= ${since.toISOString()}::timestamptz AND profile_id IS NOT NULL AND ua_hash IS NOT NULL
    GROUP BY profile_id
  `);
  const map = new Map<string, number>();
  for (const row of res.rows) map.set(row['profile_id'] as string, Number(row['distinct_ua']));
  return map;
}

/** Computes a bot_score for every profile with any signal data in the lookback window. */
export async function computeBotScores(
  db: Db,
  at: Date,
): Promise<{ profileId: string; score: number }[]> {
  const since = new Date(at.getTime() - BOT_SCORE_LOOKBACK_DAYS * 24 * 3600_000);

  const [latency, fanout, spread, uaChurn] = await Promise.all([
    queryLatencySignals(db, since),
    queryFanoutSignals(db, since),
    querySpreadSignals(db, since),
    queryUaChurnSignals(db, since),
  ]);

  const profileIds = new Set<string>([
    ...latency.keys(),
    ...fanout.keys(),
    ...spread.keys(),
    ...uaChurn.keys(),
  ]);

  return [...profileIds].map((profileId) => {
    const l = latency.get(profileId);
    const score = combineBotScore({
      latencyMeanMs: l?.meanMs ?? null,
      latencyStdDevMs: l?.stdDevMs ?? null,
      maxIpFanout: fanout.get(profileId) ?? null,
      distinctActiveHours: spread.get(profileId) ?? null,
      distinctUaHashes: uaChurn.get(profileId) ?? null,
    });
    return { profileId, score };
  });
}

export const botScoreHandler: JobHandler = async (ctx) => {
  const at = new Date();
  const scores = await computeBotScores(ctx.db, at);
  await updateProfileBotScores(ctx.db, scores);
  const flagged = scores.filter((s) => s.score >= BOT_EXCLUDE_THRESHOLD).length;
  logger.info({ scored: scores.length, flagged }, 'bot:score complete');
};
