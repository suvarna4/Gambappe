/**
 * `settleQuestion` (WS19-T1, D-J3): settle a graded daily question — flip `locked` → `revealed`,
 * stamp `revealed_at = now` (the column KEEPS its name; presentation reads it as "settled at"),
 * apply the §6.6 daily-streak increment for every graded participant, detect the "called it"
 * badge (§6.7/WS3-T6), complete any duo matches whose window covers this daily (§8.5/§8.9), then
 * best-effort revalidate the ISR pages (§6.7, §9.2) and fire the per-settle web-push.
 *
 * This is the single settle/grade entry point the WS3-T4 reveal worker used to own inline: D-J3
 * ("settlement follows reality") CUTS the synchronized clock-scheduled reveal ceremony, so this
 * logic no longer fires on a per-question `reveal_at` clock — it runs the moment the venue market
 * resolves, in the same tick as grading (`grade:followup`, §6.5). Everything inside the single
 * transaction below is identical to the old `reveal:fire` body (streak replay, called_it,
 * WS9-T3 per-outcome beats) so a crash mid-run rolls back cleanly and a redelivery reprocesses
 * from scratch — never a partially-applied settle.
 *
 * Two deliberate departures from the old ceremony (D-J3):
 *   1. No re-arm / no prior-day (D−1) ordering gate. A question settles whenever its market
 *      resolves, any time of day; there is no synchronized "reveal at 8" moment to order against.
 *      The monotonic streak replay (`applyStreakForParticipant`) already tolerates out-of-order
 *      settles (audit 9.1 — see `reveal-out-of-order-streaks.test.ts`).
 *   2. The old general "reveal at 8" push/email beat is replaced by a per-settle web-push
 *      (`⚡ {headline} — it's done. …`) gated to the FIRST settle of a profile's day: the
 *      `reveal_settle:{etDate}:{profileId}` dedupe key makes the first settle of the ET day
 *      insert a push and every later settle that day a silent no-op — the 21:00 ET `settle:digest`
 *      job (`../jobs/settle-digest.ts`) covers the rest with one summary push.
 *
 * Callable only for a `locked`, already-graded (`settled_at` set) question — an ungraded or
 * already-settled question is an idempotent no-op (`revealQuestionTx` is itself status-guarded).
 */
import type pg from 'pg';
import { now } from '@receipts/core';
import { isCalledIt } from '@receipts/engine';
import {
  applyStreakForParticipant,
  createDb,
  getGradedPicksForQuestion,
  getProfileById,
  getQuestionById,
  insertAnalyticsEvent,
  listOpenMatchIdsForWindowDate,
  listRevealedOrVoidedDailyThrough,
  revealQuestionTx,
  sendNotification,
  type Db,
} from '@receipts/db';
import { logger } from '../logger.js';
import { buildQuestionUrl } from './question-url.js';
import { etDateString } from './day-window.js';
import { questionRevalidationPaths, requestRevalidation } from './revalidate.js';
import { tryCompleteDuoMatch } from '../jobs/duo-match-completion.js';
import { deriveRevealBeats } from '../notifications/reveal-beats.js';
import { writeBeatsToOutbox } from '../notifications/write-outbox.js';

function impliedEntryProb(side: 'yes' | 'no', yesPriceAtEntry: number): number {
  return side === 'yes' ? yesPriceAtEntry : 1 - yesPriceAtEntry;
}

/** Per-settle push copy (D-J3). `{headline}` is the question's headline. */
export function settlePushLine(headline: string): string {
  return `⚡ ${headline} — it's done. Your receipt just graded itself.`;
}

export type SettleOutcome =
  | { status: 'not_found' }
  | { status: 'noop' } // not `locked`, or ungraded — an idempotent no-op
  | {
      status: 'revealed';
      participantCount: number;
      calledItCount: number;
      /** outbox rows written (per-outcome beats + first-of-day settle pushes). */
      beatsWritten: number;
      /** first-of-day settle pushes actually inserted (deduped later settles don't count). */
      pushed: number;
    };

/**
 * Settle one graded daily question. `db` is the pooled handle; `pool` supplies the single
 * transactional client the streak/beat writes commit through together (same one-transaction-or-
 * none crash-safety the old reveal worker relied on).
 */
export async function settleQuestion(
  db: Db,
  pool: pg.Pool,
  questionId: string,
  at: Date = now(),
): Promise<SettleOutcome> {
  const question = await getQuestionById(db, questionId);
  if (!question) {
    logger.warn({ questionId }, 'settle — question not found');
    return { status: 'not_found' };
  }
  if (question.status !== 'locked' || !question.settledAt) {
    // Already settled/voided, never locked, or not yet graded — idempotent no-op (§5.7).
    return { status: 'noop' };
  }

  const gradedPicks = await getGradedPicksForQuestion(db, questionId);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tx: Db = createDb(client);

    const revealResult = await revealQuestionTx(tx, questionId, at);
    if (!revealResult.revealed) {
      await client.query('ROLLBACK');
      return { status: 'noop' }; // lost a race with another instance — already settled
    }

    let calledItCount = 0;
    let beatsWritten = 0;
    let pushed = 0;
    if (question.questionDate) {
      const questionDate = question.questionDate;
      const etDate = etDateString(at);
      const dailyHistory = await listRevealedOrVoidedDailyThrough(tx, questionDate);
      const ctaUrl = buildQuestionUrl(question.slug);
      for (const gp of gradedPicks) {
        const streakResult = await applyStreakForParticipant(tx, gp.profileId, dailyHistory, questionDate, at);

        const impliedProbability = impliedEntryProb(gp.side, gp.yesPriceAtEntry);
        const calledIt = gp.result === 'win' && isCalledIt(impliedProbability);
        if (calledIt) {
          calledItCount += 1;
          await insertAnalyticsEvent(tx, {
            ts: at,
            event: 'called_it',
            profileId: gp.profileId,
            props: { question_id: questionId, side: gp.side, yes_price_at_entry: gp.yesPriceAtEntry },
          });
        }

        // WS9-T3 (§13.3): per-outcome beats (streak_milestone/streak_busted/streak_freeze_used/
        // called_it) — unchanged, email-only, derived from the same replay result computed above.
        const profile = await getProfileById(tx, gp.profileId);
        const beats = deriveRevealBeats({
          profileId: gp.profileId,
          handle: profile?.handle ?? gp.profileId,
          questionDate,
          currentStreak: streakResult.currentStreak,
          runs: streakResult.runs,
          currentRunStartedOn: streakResult.currentRunStartedOn,
          freezeUsedForGap: streakResult.freezeUsedForGap,
          freezeBankAfter: streakResult.freezeBankAfter,
          calledIt,
          impliedProbability,
        });
        const outboxReport = await writeBeatsToOutbox(tx, beats, at);
        beatsWritten += outboxReport.written;

        // D-J3: per-settle web-push, gated to the FIRST settle of this profile's ET day. The
        // date-scoped dedupe key makes later same-day settles silent no-ops (`settle:digest`
        // covers them). Kind `reveal_settle` (reveal_* → 'reveal' category, §9.4) so it is
        // dispatchable on the `push_reveal` opt-in, unlike a 'product'-category push.
        const settlePush = await sendNotification(
          tx,
          gp.profileId,
          'reveal_settle',
          { line: settlePushLine(question.headline), ...(ctaUrl ? { ctaUrl, ctaLabel: 'See the receipt' } : {}) },
          'push',
          `reveal_settle:${etDate}:${gp.profileId}`,
          at,
        );
        if (settlePush.inserted) {
          beatsWritten += 1;
          pushed += 1;
        }
      }

      const matchIds = await listOpenMatchIdsForWindowDate(tx, questionDate);
      for (const matchId of matchIds) {
        await tryCompleteDuoMatch(tx, matchId, at);
      }
    }

    await client.query('COMMIT');

    // Best-effort, post-commit only (never throws; ISR timer is the fallback). Makes the public
    // page flip to settled NOW instead of up to ~ISR_REVALIDATE_QUESTION_S later.
    await requestRevalidation(questionRevalidationPaths(question.slug));

    return { status: 'revealed', participantCount: gradedPicks.length, calledItCount, beatsWritten, pushed };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
