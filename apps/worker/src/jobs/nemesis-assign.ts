/**
 * `nemesis:assign` (WS5-T1, §8.4, §7.6: Mon 09:00 ET). Pool build → matcher → persist → notify.
 *
 * Step 0 (§8.4): season check (auto-creates the next `NEMESIS_SEASON_WEEKS`-week season if none
 * covers this week — "assignment never silently no-ops on a season boundary"), then rematches
 * first (mutually-accepted `rematch_requests` become forced pairings, marked `is_rematch`; every
 * other request — open or just-consumed-accepted — is swept to `expired`, §5.5).
 *
 * Steps 1–4: builds the eligible pool (claimed, active, not nemesis-paused, ≥ NEMESIS_MIN_PICKS
 * graded picks, bot_score below threshold — `listNemesisEligiblePool`), calls WS4-T4's pure
 * `matchNemeses` with the pool + blocked/paired-this-season history + forced pairs, persists the
 * resulting pairings (canonical `profile_a<profile_b`, already guaranteed by the pure function),
 * selects bonus questions per §8.8.1 for pairings with `nemesis_eligible` markets available
 * (best-effort — 0-bonus is valid), flags leftovers with `matchmaking_priority=true` for next
 * run (and clears it for everyone who got a shot this run, matched or not), and enqueues the
 * "Meet your nemesis" (`nemesis_assigned`) beat via WS9-T1's `sendNotification`.
 *
 * Idempotency (§19.4 rule 4): `nemesis_pairings`'s partial-unique `(season_id, week_start,
 * profile_a_id/b_id)` makes a stray re-run's INSERTs fail loudly rather than silently
 * double-pairing — pg-boss's singleton weekly cron is the primary guard (§7.6 header), this is
 * the defense-in-depth backstop. `rematch_requests` transitions and `matchmaking_priority`
 * writes are plain idempotent UPDATEs (re-running with the same inputs converges).
 *
 * Behind the `nemesis` flag (§4.6: "off until WS5 E2E passes") — same posture as
 * `duo:matchmaker`/`duo_queue`.
 */
import { uuidv7 } from 'uuidv7';
import {
  BOT_EXCLUDE_THRESHOLD,
  NEMESIS_MIN_PICKS,
  etDateString,
  isFlagEnabled,
  isoWeekMonday,
  now,
} from '@receipts/core';
import { matchNemeses, narrate, type NemesisForcedPair, type NemesisPoolEntry } from '@receipts/engine';
import {
  getOrCreateNemesisSeasonCovering,
  insertNemesisPairingRow,
  insertPairingQuestionRows,
  listAcceptedRematchRequests,
  listAllBlockedPairs,
  listNemesisEligiblePool,
  listOpenRematchRequestIds,
  listPairedProfilePairsForSeason,
  markRematchRequestsExpired,
  sendNotification,
  setMatchmakingPriority,
  type Db,
  type NemesisPoolRow,
} from '@receipts/db';
import type PgBoss from 'pg-boss';
import type { JobHandler } from '../heartbeat.js';
import { logger } from '../logger.js';
import { timeZoneOffsetMinutes } from '../lib/day-window.js';
import { selectNemesisBonusQuestions } from '../lib/nemesis-bonus.js';
import { scheduleQuestionLifecycle } from './question-lifecycle.js';

/** Unordered pair key — mirrors `packages/engine/src/nemesis-matcher.ts`'s private `pairKey`
 * (not exported; this job independently needs the same canonicalization for its own
 * blocked/forced-pair set-membership checks ahead of calling the pure matcher). */
function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export interface NemesisAssignReport {
  seasonId: string;
  seasonCreated: boolean;
  weekStart: string;
  poolSize: number;
  pairingsCreated: number;
  forcedPairingsCreated: number;
  leftovers: number;
  bonusQuestionsCreated: number;
  rematchRequestsExpired: number;
}

async function buildForcedPairs(
  db: Db,
  poolIds: ReadonlySet<string>,
  blockedKeys: ReadonlySet<string>,
): Promise<{ forcedPairs: NemesisForcedPair[]; requestIdsToExpire: string[] }> {
  const acceptedRequests = await listAcceptedRematchRequests(db);
  const openRequestIds = await listOpenRematchRequestIds(db);

  const forcedPairs: NemesisForcedPair[] = [];
  const seenKeys = new Set<string>();
  const requestIdsToExpire: string[] = [...openRequestIds];

  for (const req of acceptedRequests) {
    // Every accepted request is consumed (swept to `expired`) this run regardless of outcome —
    // see `markRematchRequestsExpired`'s doc comment for why (no `fulfilled` status exists).
    requestIdsToExpire.push(req.id);

    const a = req.requesterProfileId;
    const b = req.targetProfileId;
    const key = pairKey(a, b);
    if (seenKeys.has(key)) continue; // both sides independently requested each other — one pair.
    if (!poolIds.has(a) || !poolIds.has(b)) continue; // no longer eligible — drop silently.
    if (blockedKeys.has(key)) continue; // blocked since acceptance — drop silently.
    seenKeys.add(key);
    forcedPairs.push({ profileAId: a, profileBId: b });
  }

  return { forcedPairs, requestIdsToExpire };
}

function toPoolEntry(row: NemesisPoolRow, at: Date): NemesisPoolEntry {
  return {
    profileId: row.profileId,
    rating: row.rating,
    rd: row.rd,
    utcOffsetHours: row.timezone ? timeZoneOffsetMinutes(at, row.timezone) / 60 : null,
    matchmakingPriority: row.matchmakingPriority,
    chalk: row.chalk,
    contrarian: row.contrarian,
    timing: row.timing,
    categoryShares: row.categoryShares,
  };
}

async function sendNemesisAssignedNotifications(
  db: Db,
  pairingId: string,
  a: NemesisPoolRow,
  b: NemesisPoolRow,
  at: Date,
): Promise<void> {
  const lineForA = narrate({
    beat: 'nemesis_assigned',
    data: { opponentHandle: b.handle, self: a, opponent: b },
  });
  const lineForB = narrate({
    beat: 'nemesis_assigned',
    data: { opponentHandle: a.handle, self: b, opponent: a },
  });

  // Both channels enqueued (§13.2: email + push both apply to the `nemesis` category,
  // §9.4 `push_nemesis`/`email_nemesis`) — `notify:dispatch` (WS9-T1) currently only drains
  // `channel='email'` rows; `channel='push'` rows sit queued harmlessly until WS9-T2 (web push)
  // lands, same posture `duo:matchmaker` already takes for `duo_matched`.
  for (const [profileId, opponentId, line] of [
    [a.profileId, b.profileId, lineForA],
    [b.profileId, a.profileId, lineForB],
  ] as const) {
    const payload = { line: line.line, emphasis: line.emphasis ?? null, pairing_id: pairingId, opponent_profile_id: opponentId };
    await sendNotification(db, profileId, 'nemesis_assigned', payload, 'email', `nemesis_assigned:${pairingId}:${profileId}:email`, at);
    await sendNotification(db, profileId, 'nemesis_assigned', payload, 'push', `nemesis_assigned:${pairingId}:${profileId}:push`, at);
  }
}

export async function runNemesisAssign(db: Db, boss: PgBoss, at: Date = now()): Promise<NemesisAssignReport> {
  const weekStart = isoWeekMonday(etDateString(at));

  // --- Step 0: season check (§8.4) ---------------------------------------------------------
  const { season, created: seasonCreated } = await getOrCreateNemesisSeasonCovering(db, weekStart);
  if (seasonCreated) {
    // SPEC-GAP(ws5-t1): "(and notifies admins)" — no admin notification channel/audience exists
    // yet (mirrors WS3-T4's identical SPEC-GAP for reveal-delay admin escalation); logged loudly
    // instead so an ops dashboard/log alert can pick it up until WS10 grows one.
    logger.warn({ seasonId: season.id, startsOn: season.startsOn, endsOn: season.endsOn }, 'nemesis:assign — auto-created next nemesis season');
  }

  // --- Pool (§8.4 eligible pool) ------------------------------------------------------------
  // `weekStart` excludes anyone already holding a scheduled/active pairing for the week — the
  // WS20-T3 call-out double-assignment guard (D-J5).
  const poolRows = await listNemesisEligiblePool(db, BOT_EXCLUDE_THRESHOLD, NEMESIS_MIN_PICKS, weekStart);
  const poolById = new Map(poolRows.map((r) => [r.profileId, r]));
  const poolIds = new Set(poolRows.map((r) => r.profileId));
  const poolEntries: NemesisPoolEntry[] = poolRows.map((r) => toPoolEntry(r, at));

  const blockedPairs = await listAllBlockedPairs(db);
  const blockedKeys = new Set(blockedPairs.map(([a, b]) => pairKey(a, b)));

  // --- Step 0 continued: rematches first ----------------------------------------------------
  const { forcedPairs, requestIdsToExpire } = await buildForcedPairs(db, poolIds, blockedKeys);
  await markRematchRequestsExpired(db, requestIdsToExpire);

  // --- Steps 1-3: matching (WS4-T4 pure function) -------------------------------------------
  const pairedThisSeason = await listPairedProfilePairsForSeason(db, season.id);
  const matchResult = matchNemeses(poolEntries, { blockedPairs, pairedThisSeason }, { forcedPairs });

  // --- Persist pairings, bonus questions, notifications -------------------------------------
  let bonusQuestionsCreated = 0;
  let forcedPairingsCreated = 0;
  for (const pairing of matchResult.pairings) {
    const rowA = poolById.get(pairing.profileAId);
    const rowB = poolById.get(pairing.profileBId);
    if (!rowA || !rowB) {
      // Defensive — every pairing's members came from `poolEntries`/`forcedPairs`, both of
      // which are drawn from `poolById`'s keys. Unreachable in practice; skip rather than crash.
      logger.error({ pairing }, 'nemesis:assign — pairing references a profile outside the pool, skipping');
      continue;
    }

    const pairingId = uuidv7();
    await insertNemesisPairingRow(db, {
      id: pairingId,
      seasonId: season.id,
      weekStart,
      profileAId: pairing.profileAId,
      profileBId: pairing.profileBId,
      // §5.7: "scheduled → active (Monday open)". No separate job transitions scheduled→active
      // for nemesis pairings (unlike daily questions' question:open) — assignment IS "Monday
      // open", so pairings are created directly `active`. SPEC-GAP(ws5-t1): the doc's exact
      // wording leaves this implicit; see this task's PR description for the reasoning.
      status: 'active',
      isRematch: pairing.isRematch,
      verdict: null,
    });
    if (pairing.isRematch) forcedPairingsCreated += 1;

    let bonusQuestions: Awaited<ReturnType<typeof selectNemesisBonusQuestions>> = [];
    try {
      bonusQuestions = await selectNemesisBonusQuestions(db, {
        weekStart,
        sharesA: rowA.categoryShares,
        sharesB: rowB.categoryShares,
      });
    } catch (err) {
      // Best-effort (§8.8: "0-bonus week is valid") — never let bonus selection fail the pairing.
      logger.warn({ err, pairingId }, 'nemesis:assign — bonus question selection failed, continuing with 0 bonus');
    }
    if (bonusQuestions.length > 0) {
      await insertPairingQuestionRows(db, pairingId, bonusQuestions.map((q) => q.id));
      bonusQuestionsCreated += bonusQuestions.length;
      for (const q of bonusQuestions) {
        // Already `open` (authored that way, §8.8.1 "open_at = creation time") — only
        // question:lock/reveal:fire need scheduling; scheduleQuestionLifecycle also sends
        // question:open, which is a harmless no-op (openQuestionTx only transitions from
        // `scheduled`, §5.7).
        await scheduleQuestionLifecycle(boss, q);
      }
    }

    await sendNemesisAssignedNotifications(db, pairingId, rowA, rowB, at);
  }

  // --- Step 4: leftovers (§8.4) -------------------------------------------------------------
  // Everyone who had a shot this run gets their PRIOR priority cleared first (matched or not) —
  // then leftovers alone get flagged true for next run's +PRIORITY_BONUS.
  await setMatchmakingPriority(db, [...poolIds], false);
  await setMatchmakingPriority(db, matchResult.leftoverProfileIds, true);

  return {
    seasonId: season.id,
    seasonCreated,
    weekStart,
    poolSize: poolEntries.length,
    pairingsCreated: matchResult.pairings.length,
    forcedPairingsCreated,
    leftovers: matchResult.leftoverProfileIds.length,
    bonusQuestionsCreated,
    rematchRequestsExpired: requestIdsToExpire.length,
  };
}

export const nemesisAssignHandler: JobHandler = async (ctx) => {
  if (!isFlagEnabled('nemesis')) {
    logger.debug('nemesis:assign skipped — nemesis flag disabled');
    return;
  }
  const report = await runNemesisAssign(ctx.db, ctx.boss);
  logger.info({ report }, 'nemesis:assign complete');
};
