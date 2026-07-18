/**
 * `duo:window-roll` (Tue/Fri 09:00 ET, WS6-T2, §8.5). Two responsibilities each run:
 *
 * 1. STRAGGLER BACKSTOP (§8.5: "a match transitions to completed by grade:followup when its
 *    last question grades, or by the next window-roll as a backstop for stragglers, excluding
 *    never-graded questions per §8.9"): every `scheduled`/`active` match whose window has
 *    already fully elapsed gets force-completed on whatever graded — `scoreDuoMatch`'s existing
 *    exclusion handling degrades an all-excluded match to a 0-0 draw, so this never needs a
 *    separate "give up" branch. Runs FIRST so any duo stuck in a straggling prior-window match
 *    is free to be paired again below.
 *
 * 2. WINDOW CREATION: pairs `active` duos with no current match, within tier, by closest team
 *    rating (`matchDuoVsDuo` — WS4-T5's pure function, `packages/engine/src/duo-matcher.ts`;
 *    this job does NOT reimplement that algorithm, only the DB-facing wiring around it — same
 *    division of labor as `duo:matchmaker`'s partner-matching, WS6-T1). Each new match gets the
 *    window's 3 daily questions (derived by date, never stored — §5.5) plus up to 3 curated
 *    `duo_bonus` questions (§8.8.1 authoring; 0-bonus is valid if no eligible market pool
 *    exists, mirroring nemesis's bonus rule).
 *
 * Windows are fixed calendar (§8.5): Tue–Thu (dailies of Tue/Wed/Thu) or Fri–Sun (Fri/Sat/Sun);
 * Monday's daily belongs to no duo window. This job only ever fires on Tue or Fri (cron `0 9 *
 * * 2,5`, `registry.ts`), so `computeWindow` derives the 3-day span from whichever of those two
 * days `at` falls on.
 *
 * SPEC-GAP(ws6-t2): §8.5 says the odd duo out (an odd-sized tier) "sits the window and gets
 * priority next roll" — `matchDuoVsDuo`'s own doc comment: "caller flags priority-next". Unlike
 * nemesis's leftover mechanic (`profiles.matchmaking_priority`, a real column consumed as an
 * edge-score bonus by `matchNemeses`), `duos` (§5.5) has NO equivalent column, and
 * `matchDuoVsDuo` takes no priority input at all (unlike `matchNemeses`'s `constraints` param) —
 * adding one is a `packages/db` schema change this task's rules bar. §19.3 also assigns
 * "odd-duo sit-out priority" testing to WS6-T3 ("Ladder + windows"), which depends on this task
 * — so the actual priority mechanic (most likely a contract-change adding a `duos` column) is
 * left for that PR rather than inventing a heuristic here that might conflict with it. This job
 * still correctly computes and logs `oddOneOut` every run, so WS6-T3 has the observable signal
 * to build on.
 */
import { uuidv7 } from 'uuidv7';
import type PgBoss from 'pg-boss';
import { addDaysToDateString, etDateString, isFlagEnabled, now, SCHEDULE_TZ } from '@receipts/core';
import {
  createDuoMatch,
  findReusableDuoBonusQuestionForMarket,
  insertDuoMatchQuestion,
  insertQuestion,
  listDuoBonusCandidateMarkets,
  listEligibleDuosForWindowRoll,
  listOverdueOpenMatches,
  type Db,
} from '@receipts/db';
import { matchDuoVsDuo, type DuoTeam } from '@receipts/engine';
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
}

export async function runDuoWindowRoll(db: Db, boss: PgBoss, at: Date = now()): Promise<DuoWindowRollReport | null> {
  const window = computeWindow(at);
  if (!window) {
    logger.warn({ at }, 'duo:window-roll fired on a non-Tue/Fri ET date — skipping (cron should prevent this)');
    return null;
  }

  // 1. Straggler backstop (§8.5) — force-completes any match whose window already elapsed,
  // freeing its duos to be re-paired below.
  const todayEtDate = etDateString(at);
  const overdue = await listOverdueOpenMatches(db, todayEtDate);
  let backstopCompleted = 0;
  for (const match of overdue) {
    const result = await tryCompleteDuoMatch(db, match.id, at, { force: true });
    if (result.completed) backstopCompleted++;
  }

  // 2. Window creation: tier-local closest-rating pairing (WS4-T5 pure function).
  const eligible = await listEligibleDuosForWindowRoll(db);
  const teams: DuoTeam[] = eligible.map((d) => ({ duoId: d.duoId, rating: d.rating, tier: d.tier }));
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

  if (oddOneOut.length > 0) {
    logger.info(
      { oddOneOut, windowStart: window.windowStart },
      'duo:window-roll — odd duo(s) sat out this window (SPEC-GAP(ws6-t2): priority-next not persisted, see file header)',
    );
  }

  return {
    windowStart: window.windowStart,
    windowEnd: window.windowEnd,
    backstopCompleted,
    matchesCreated: pairings.length,
    oddOneOut,
    bonusQuestionsAttached: bonusQuestionIds.length,
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
