/**
 * `duo:window-roll` (Tue/Fri 09:00 ET, WS6-T2 + WS6-T3, §8.5, §8.10). Three responsibilities
 * each run:
 *
 * 1. STRAGGLER BACKSTOP (§8.5: "a match transitions to completed by grade:followup when its
 *    last question grades, or by the next window-roll as a backstop for stragglers, excluding
 *    never-graded questions per §8.9"): every `scheduled`/`active` match whose window has
 *    already fully elapsed gets force-completed on whatever graded — `scoreDuoMatch`'s existing
 *    exclusion handling degrades an all-excluded match to a 0-0 draw, so this never needs a
 *    separate "give up" branch. Runs FIRST so any duo stuck in a straggling prior-window match
 *    is free to be paired again below, and so its result counts toward that duo's win tally if
 *    step 2 below happens to conclude a season this same run.
 *
 * 2. SEASON BOUNDARY + LADDER (§8.10, WS6-T3): if no `duo` season covers this window's start
 *    date, the PREVIOUS `duo` season (if any) just ended — `resolveDuoSeason` computes
 *    promotion/relegation (`@receipts/engine`'s `computeLadderMovements`) from that season's
 *    standings, persists the tier moves, and creates the next `DUO_SEASON_WEEKS`-week season, all
 *    in one transaction (mirrors `nemesis:assign`'s step-0 season check, one level more involved
 *    since a duo season boundary also has ladder state to move atomically with the season row —
 *    see `resolveDuoSeason`'s own doc comment for the idempotency argument). Runs BEFORE window
 *    creation so step 3's tier-local pairing sees any just-applied tier moves.
 *
 * 3. WINDOW CREATION: pairs `active` duos with no current match, within tier, by closest team
 *    rating (`matchDuoVsDuo` — WS4-T5's pure function, `packages/engine/src/duo-matcher.ts`;
 *    this job does NOT reimplement that algorithm, only the DB-facing wiring around it — same
 *    division of labor as `duo:matchmaker`'s partner-matching, WS6-T1). Each new match gets the
 *    window's 3 daily questions (derived by date, never stored — §5.5) plus up to 3 curated
 *    `duo_bonus` questions (§8.8.1 authoring; 0-bonus is valid if no eligible market pool
 *    exists, mirroring nemesis's bonus rule). The odd-duo-out mechanic now carries real priority
 *    (§8.10, WS6-T3 resolves the SPEC-GAP(ws6-t2) this file used to note here): every duo
 *    considered this run has its `matchmaking_priority` cleared first, then this run's actual
 *    `oddOneOut` set gets flagged true for the NEXT run — `matchDuoVsDuo` reads that flag back in
 *    to avoid sitting the same duo out twice in a row when an alternative exists.
 *
 * Windows are fixed calendar (§8.5): Tue–Thu (dailies of Tue/Wed/Thu) or Fri–Sun (Fri/Sat/Sun);
 * Monday's daily belongs to no duo window. This job only ever fires on Tue or Fri (cron `0 9 *
 * * 2,5`, `registry.ts`), so `computeWindow` derives the 3-day span from whichever of those two
 * days `at` falls on.
 */
import { uuidv7 } from 'uuidv7';
import type PgBoss from 'pg-boss';
import {
  addDaysToDateString,
  DUO_SEASON_WEEKS,
  etDateString,
  isFlagEnabled,
  now,
  SCHEDULE_TZ,
} from '@receipts/core';
import {
  applyDuoTierMovements,
  createDuoMatch,
  findReusableDuoBonusQuestionForMarket,
  getDuoSeasonCoveringDate,
  getMostRecentDuoSeason,
  insertDuoMatchQuestion,
  insertQuestion,
  insertSeason,
  listDuoBonusCandidateMarkets,
  listDuoSeasonStandings,
  listEligibleDuosForWindowRoll,
  listOverdueOpenMatches,
  setDuoMatchmakingPriority,
  type Db,
} from '@receipts/db';
import { computeLadderMovements, matchDuoVsDuo, type DuoTeam } from '@receipts/engine';
import type { JobHandler } from '../heartbeat.js';
import { logger } from '../logger.js';
import { tryCompleteDuoMatch } from './duo-match-completion.js';
import { scheduleQuestionLifecycle } from './question-lifecycle.js';

/** §8.5: "Match = the window's 3 daily questions ... + 3 curated duo_bonus questions". */
const DUO_BONUS_PER_MATCH = 3;
/** Headroom past DUO_BONUS_PER_MATCH so a market close to the window edge or a dedup miss
 * doesn't leave the pool short. */
const DUO_BONUS_CANDIDATE_POOL = 12;

/**
 * The UTC instant of `HH:mm:00` ET on `dateStr` (`YYYY-MM-DD`). DST-safe via a 2-pass trial
 * offset correction (converges after one correction; the second pass is defensive). No reverse
 * `etDateString` helper exists in `@receipts/core` to reuse for this single call site, and this
 * task's rules bar adding one there for it.
 */
function etInstant(dateStr: string, hour: number, minute: number): Date {
  const [y, m, d] = dateStr.split('-').map(Number) as [number, number, number];
  let guess = Date.UTC(y, m - 1, d, hour, minute, 0);
  const target = Date.UTC(y, m - 1, d, hour, minute, 0);
  for (let i = 0; i < 2; i++) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: SCHEDULE_TZ,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(new Date(guess));
    const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value ?? 0);
    const hh = get('hour') % 24; // Intl sometimes reports midnight as "24" under h23
    const observed = Date.UTC(get('year'), get('month') - 1, get('day'), hh, get('minute'));
    guess += target - observed;
  }
  return new Date(guess);
}

export interface DuoWindow {
  windowStart: string;
  windowEnd: string;
}

/** Tue → [Tue,Wed,Thu]; Fri → [Fri,Sat,Sun] (§8.5 fixed calendar). Null on any other ET weekday
 * — shouldn't happen given the `0 9 * * 2,5` cron, defensive only. */
export function computeWindow(at: Date): DuoWindow | null {
  const today = etDateString(at);
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0=Sun..6=Sat
  if (dow !== 2 && dow !== 5) return null;
  return { windowStart: today, windowEnd: addDaysToDateString(today, 2) };
}

/**
 * Resolves (create-or-reuse, §8.8.1 dedup) up to `DUO_BONUS_PER_MATCH` `duo_bonus` question ids
 * for the window. Every match created this run shares the SAME resolved set — nothing in §8.5
 * calls for per-match differentiation beyond §8.8's nemesis-only "top overlapping categories"
 * heuristic, which needs 4-profile category-overlap complementarity this task doesn't attempt
 * (SPEC-GAP(ws6-t2): candidates are selected purely by soonest-closing, not category fit —
 * defensible per §8.8.1's own fallback, "skip bonus if none fit — a 0-bonus week is valid",
 * which already anticipates a simplified selection being acceptable).
 */
async function resolveBonusQuestionIds(
  db: Db,
  boss: PgBoss,
  window: DuoWindow,
  at: Date,
): Promise<string[]> {
  const windowStartInstant = etInstant(window.windowStart, 0, 0);
  const windowEndInstant = etInstant(window.windowEnd, 23, 59);
  // §8.8.1: "lock_at = the earlier of (market close_time, ... window_end 12:00 ET for duo)".
  const lockAtCap = etInstant(window.windowEnd, 12, 0);

  const candidates = await listDuoBonusCandidateMarkets(
    db,
    windowStartInstant,
    windowEndInstant,
    DUO_BONUS_CANDIDATE_POOL,
  );

  const questionIds: string[] = [];
  for (const market of candidates) {
    if (questionIds.length >= DUO_BONUS_PER_MATCH) break;

    const existing = await findReusableDuoBonusQuestionForMarket(db, market.id);
    if (existing) {
      questionIds.push(existing.id);
      continue;
    }

    const questionId = uuidv7();
    const lockAt = market.closeTime.getTime() < lockAtCap.getTime() ? market.closeTime : lockAtCap;
    const question = await insertQuestion(db, {
      id: questionId,
      kind: 'duo_bonus',
      marketId: market.id,
      questionDate: null,
      slug: `duo-bonus-${questionId}`,
      headline: market.title, // §8.8.1 default: market title verbatim
      yesLabel: 'Yes',
      noLabel: 'No',
      openAt: at, // §8.8.1: "open_at = creation time"
      lockAt,
      revealAt: lockAt, // §8.8.1: bonus questions have no held reveal
      status: 'scheduled',
    });
    await scheduleQuestionLifecycle(boss, question);
    questionIds.push(questionId);
  }
  return questionIds;
}

export interface DuoWindowRollReport {
  windowStart: string;
  windowEnd: string;
  backstopCompleted: number;
  matchesCreated: number;
  oddOneOut: string[];
  bonusQuestionsAttached: number;
  seasonId: string;
  /** True the one run per `DUO_SEASON_WEEKS` where a new `duo` season was created (§8.10). */
  seasonRolled: boolean;
  ladderPromoted: number;
  ladderRelegated: number;
}

export interface DuoSeasonRollResult {
  seasonId: string;
  seasonRolled: boolean;
  ladderPromoted: number;
  ladderRelegated: number;
}

/**
 * §8.10 season-boundary check, mirroring `nemesis:assign`'s step-0 pattern one level deeper: a
 * duo season boundary has ladder state (tier moves) that must land atomically WITH the new
 * season row, not just the row itself. If a crash happened between "tier moves applied" and
 * "new season inserted", a naive retry would re-run `getDuoSeasonCoveringDate` for the same
 * `window.windowStart`, still find nothing covering it, and re-derive + re-apply the SAME
 * movements against the (already-moved) `duos.tier` values a second time — silently wrong, not
 * just redundant, since `computeLadderMovements` isn't idempotent against its own output. Wrapping
 * standings-read → movements → tier UPDATEs → season INSERT in one transaction closes that
 * window: a crash mid-way rolls everything back, so a retry sees the prior season still
 * uncovering `window.windowStart` and correctly starts over from unmoved tiers.
 *
 * No-op (fast path, no transaction) when a `duo` season already covers `window.windowStart` —
 * the common case, true on every run except the ~1-in-8 (`DUO_SEASON_WEEKS`=4 weeks × 2
 * windows/week) run that actually crosses a boundary.
 */
export async function resolveDuoSeason(db: Db, window: DuoWindow, at: Date): Promise<DuoSeasonRollResult> {
  const current = await getDuoSeasonCoveringDate(db, window.windowStart);
  if (current) {
    return { seasonId: current.id, seasonRolled: false, ladderPromoted: 0, ladderRelegated: 0 };
  }

  return db.transaction(async (tx) => {
    // Re-check inside the transaction — pg-boss's singleton cron (§7.6 header) is the primary
    // guard against a concurrent duplicate run; this is defense-in-depth, same posture as
    // `ratings:weekly`'s per-item re-check-after-lock.
    const stillNone = await getDuoSeasonCoveringDate(tx, window.windowStart);
    if (stillNone) {
      return { seasonId: stillNone.id, seasonRolled: false, ladderPromoted: 0, ladderRelegated: 0 };
    }

    let ladderPromoted = 0;
    let ladderRelegated = 0;
    const previousSeason = await getMostRecentDuoSeason(tx);
    if (previousSeason) {
      const standings = await listDuoSeasonStandings(tx, previousSeason.startsOn, previousSeason.endsOn);
      const movements = computeLadderMovements(standings);
      if (movements.length > 0) {
        await applyDuoTierMovements(tx, movements, at);
        ladderPromoted = movements.filter((m) => m.direction === 'promoted').length;
        ladderRelegated = movements.filter((m) => m.direction === 'relegated').length;
        logger.info(
          { seasonId: previousSeason.id, ladderPromoted, ladderRelegated },
          'duo:window-roll — ladder promotion/relegation applied at duo-season end (§8.10)',
        );
      }
    }
    // Bootstrap (no previous `duo` season at all yet): nothing to conclude — every duo is
    // already tier 1 by schema default (§8.10 "new duos enter tier 1"), so 0 movements is
    // correct, not a gap.

    const startsOn = window.windowStart;
    const endsOn = addDaysToDateString(startsOn, DUO_SEASON_WEEKS * 7 - 1);
    const season = await insertSeason(tx, {
      id: uuidv7(),
      kind: 'duo',
      startsOn,
      endsOn,
      name: `Duo Season (${startsOn})`,
    });
    logger.info({ seasonId: season.id, startsOn, endsOn }, 'duo:window-roll — started next duo season');

    return { seasonId: season.id, seasonRolled: true, ladderPromoted, ladderRelegated };
  });
}

export async function runDuoWindowRoll(db: Db, boss: PgBoss, at: Date = now()): Promise<DuoWindowRollReport | null> {
  const window = computeWindow(at);
  if (!window) {
    logger.warn({ at }, 'duo:window-roll fired on a non-Tue/Fri ET date — skipping (cron should prevent this)');
    return null;
  }

  // 1. Straggler backstop (§8.5) — force-completes any match whose window already elapsed,
  // freeing its duos to be re-paired below (and counting toward its win tally if step 2 below
  // concludes a season this same run).
  const todayEtDate = etDateString(at);
  const overdue = await listOverdueOpenMatches(db, todayEtDate);
  let backstopCompleted = 0;
  for (const match of overdue) {
    const result = await tryCompleteDuoMatch(db, match.id, at, { force: true });
    if (result.completed) backstopCompleted++;
  }

  // 2. Season boundary + ladder promotion/relegation (§8.10, WS6-T3) — before window creation
  // so step 3's tier-local pairing sees any tier moves just applied.
  const seasonRoll = await resolveDuoSeason(db, window, at);

  // 3. Window creation: tier-local closest-rating pairing (WS4-T5 pure function), now priority-
  // aware (§8.10 odd-duo sit-out priority, WS6-T3).
  const eligible = await listEligibleDuosForWindowRoll(db);
  const teams: DuoTeam[] = eligible.map((d) => ({
    duoId: d.duoId,
    rating: d.rating,
    tier: d.tier,
    matchmakingPriority: d.matchmakingPriority,
  }));
  const { pairings, oddOneOut } = matchDuoVsDuo(teams);

  const bonusQuestionIds = pairings.length > 0 ? await resolveBonusQuestionIds(db, boss, window, at) : [];

  for (const pairing of pairings) {
    const match = await createDuoMatch(db, {
      id: uuidv7(),
      duoAId: pairing.duoAId,
      duoBId: pairing.duoBId,
      windowStart: window.windowStart,
      windowEnd: window.windowEnd,
    });
    for (const questionId of bonusQuestionIds) {
      await insertDuoMatchQuestion(db, match.id, questionId);
    }
  }

  // Everyone considered this run (matched or sat out) gets their PRIOR priority cleared first —
  // then this run's actual leftover(s) alone get flagged true for next run (mirrors
  // `nemesis:assign`'s step-4 leftover bookkeeping exactly, one table over).
  await setDuoMatchmakingPriority(db, eligible.map((d) => d.duoId), false, at);
  await setDuoMatchmakingPriority(db, oddOneOut, true, at);

  if (oddOneOut.length > 0) {
    logger.info(
      { oddOneOut, windowStart: window.windowStart },
      'duo:window-roll — odd duo(s) sat out this window, flagged matchmaking_priority for next run (§8.10)',
    );
  }

  return {
    windowStart: window.windowStart,
    windowEnd: window.windowEnd,
    backstopCompleted,
    matchesCreated: pairings.length,
    oddOneOut,
    bonusQuestionsAttached: bonusQuestionIds.length,
    seasonId: seasonRoll.seasonId,
    seasonRolled: seasonRoll.seasonRolled,
    ladderPromoted: seasonRoll.ladderPromoted,
    ladderRelegated: seasonRoll.ladderRelegated,
  };
}

export const duoWindowRollHandler: JobHandler = async (ctx) => {
  if (!isFlagEnabled('duo_queue')) {
    logger.debug('duo:window-roll skipped — duo_queue flag disabled');
    return;
  }
  const report = await runDuoWindowRoll(ctx.db, ctx.boss);
  logger.info({ report }, 'duo:window-roll complete');
};
