/**
 * `reveal:fire` (WS3-T4, §6.7): fires at `max(reveal_at, settlement_time)`. Scheduled per-
 * question at `reveal_at` (`scheduleQuestionLifecycle`, WS3-T1) and re-enqueued promptly by
 * `grade:followup` after a late grading (WS3-T3) — either instance converges on the same
 * idempotent outcome (§5.7).
 *
 * On fire: if not yet settled, re-arms itself every `REVEAL_REARM_MIN`; past
 * `REVEAL_MAX_DELAY_H` it also logs an admin-alert placeholder (SPEC-GAP(WS3-T4): no admin
 * channel exists yet, WS10) but keeps re-arming rather than dropping the question silently.
 *
 * On settle: ONE transaction flips `locked` → `revealed` AND applies the §6.6 daily-day streak
 * increment (gap rule + `current_streak += 1`) for every profile with a graded pick that day,
 * via `applyStreakForParticipant` (reusing WS2-T3's `streak-replay.ts`, not re-derived here) —
 * single transaction so a crash mid-run rolls back cleanly and a redelivery reprocesses from
 * scratch (never a partially-applied reveal). "Called it" badge (§6.7: win AND implied entry
 * probability ≤ `LONGSHOT_THRESHOLD`) is detected here and written to `analytics_events`
 * (WS3-T6). After a real reveal commits, the web app's ISR pages are revalidated best-effort
 * via `/internal/revalidate` (§6.7 "revalidate pages" — was SPEC-GAP(WS3-T4) until WS8-T3's
 * endpoint merged), so the synchronized page flip doesn't lag the ISR timer.
 *
 * WS9-T3 (§13.3): per participating profile, `streak_milestone`/`streak_busted`/
 * `streak_freeze_used`/`called_it` beats are derived (`../notifications/reveal-beats.js`, pure)
 * from the same streak-apply result and "called it" check already computed here, then written to
 * the `notifications` outbox (`../notifications/write-outbox.js`) INSIDE this same transaction —
 * so a rollback (lost the `revealQuestionTx` race) never leaves an orphaned beat, and the
 * `dedupe_key` unique constraint makes a genuine re-fire a safe no-op. SPEC-GAP(WS9-T3): actual
 * channel dispatch (`notify:dispatch`, WS9-T1/T2) is not this task's scope — this only writes the
 * outbox row.
 *
 * WS9-T4 (§13.2, "Reveal at 8"): the SAME per-participant loop also writes ONE general `reveal`
 * beat (`../notifications/reveal-general-beat.js`, pure) per participant, distinct from the
 * per-outcome beats above — every graded participant gets the "tonight's results are up"
 * announcement regardless of how their day went. It goes out on BOTH email and push
 * (`../notifications/write-multi-channel-outbox.js`), unlike WS9-T3's beats which were written
 * email-only before push dispatch (WS9-T2) existed. Same transaction, same guarantee: this code
 * is only reached after `revealQuestionTx` above has ACTUALLY flipped the row to `revealed` in
 * this same transaction (guarded by `if (!revealResult.revealed) { ROLLBACK; return noop }`
 * just above) — so "reveal notification never sent before question `revealed`" (§19.3 WS9-T4 AC)
 * holds structurally, not by job-timing trust: there is no code path that reaches
 * `deriveGeneralRevealBeat`/`writeBeatToOutboxAllChannels` without the DB having already
 * committed (pending this transaction's COMMIT below) `status='revealed'`. See
 * `reveal-beats-outbox.test.ts` for the integration test proving a still-`locked` re-arm writes
 * zero `reveal` rows.
 *
 * Daily ordering assert (§6.6: "reveal:fire for daily D never fires before D−1's daily is
 * revealed or voided"): if the prior calendar day's daily exists and hasn't settled into
 * revealed/voided yet, this run re-arms instead of proceeding — defensive; the structural
 * guarantee (REVEAL_MAX_DELAY_H + admin escalation) should make this unreachable in practice.
 * Note (audit 9.1) the assert only checks D−1, and `voidQuestionTx` has no prior-day gate at
 * all — so a void can break the induction (D−2 lagging, D−1 voided, D's check passes) and a
 * daily CAN reveal late, after newer days. The streak write survives that ordering anomaly
 * because `applyStreakForParticipant` (`@receipts/db` streaks repo) replays through
 * `max(questionDate, profile.last_counted_date)` — a late reveal is incorporated into the
 * chain, never regressing the watermark. See `reveal-out-of-order-streaks.test.ts`.
 *
 * Duo match completion hook (WS6-T2, §8.5/§8.9): a duo window's dailies are derived by date,
 * never stored in `duo_match_questions` (§5.5) — so the "a daily's result stays hidden until
 * reveal" rule (§6.5) means a daily-question's contribution to duo scoring only becomes real
 * HERE, at reveal, not at grading (`grade:followup`, which only handles this for `duo_bonus`
 * questions — see that job's header). Inside the SAME transaction as the reveal + streak writes:
 * for every `scheduled`/`active` `duo_matches` row whose window covers this daily's date, check
 * completion (`tryCompleteDuoMatch`, `duo-match-completion.ts`) — same one-transaction-or-none
 * crash-safety the streak application already relies on.
 */
import type pg from 'pg';
import type PgBoss from 'pg-boss';
import { REVEAL_MAX_DELAY_H, REVEAL_REARM_MIN, now } from '@receipts/core';
import { isCalledIt } from '@receipts/engine';
import {
  applyStreakForParticipant,
  createDb,
  getGradedPicksForQuestion,
  getPriorDayDailyQuestion,
  getProfileById,
  getQuestionById,
  insertAnalyticsEvent,
  listOpenMatchIdsForWindowDate,
  listRevealedOrVoidedDailyThrough,
  revealQuestionTx,
  type Db,
} from '@receipts/db';
import type { JobHandler } from '../heartbeat.js';
import { logger } from '../logger.js';
import { buildQuestionUrl } from '../lib/question-url.js';
import { questionRevalidationPaths, requestRevalidation } from '../lib/revalidate.js';
import { tryCompleteDuoMatch } from './duo-match-completion.js';
import { deriveRevealBeats } from '../notifications/reveal-beats.js';
import { writeBeatsToOutbox } from '../notifications/write-outbox.js';
import { deriveGeneralRevealBeat } from '../notifications/reveal-general-beat.js';
import { writeBeatToOutboxAllChannels } from '../notifications/write-multi-channel-outbox.js';

export interface RevealFireJobData {
  questionId: string;
}

function impliedEntryProb(side: 'yes' | 'no', yesPriceAtEntry: number): number {
  return side === 'yes' ? yesPriceAtEntry : 1 - yesPriceAtEntry;
}

export type RevealFireOutcome =
  | { status: 'not_found' }
  | { status: 'noop' } // already revealed/voided/otherwise not eligible
  | { status: 're_armed'; nextAttemptAt: Date }
  | { status: 'revealed'; participantCount: number; calledItCount: number; beatsWritten: number };

export async function runRevealFire(
  db: Db,
  pool: pg.Pool,
  boss: PgBoss,
  questionId: string,
  at: Date = now(),
): Promise<RevealFireOutcome> {
  const question = await getQuestionById(db, questionId);
  if (!question) {
    logger.warn({ questionId }, 'reveal:fire — question not found');
    return { status: 'not_found' };
  }
  if (question.status !== 'locked') {
    return { status: 'noop' }; // already revealed/voided, or never locked — idempotent no-op
  }

  const reArm = async (reason: string): Promise<RevealFireOutcome> => {
    const overdueH = (at.getTime() - question.revealAt.getTime()) / 3_600_000;
    if (overdueH > REVEAL_MAX_DELAY_H) {
      logger.warn(
        { questionId, overdueH, reason },
        'SPEC-GAP(WS3-T4): reveal past REVEAL_MAX_DELAY_H — would page admin channel (WS10, not built yet)',
      );
    }
    const nextAttemptAt = new Date(at.getTime() + REVEAL_REARM_MIN * 60_000);
    await boss.send('reveal:fire', { questionId }, { startAfter: nextAttemptAt });
    return { status: 're_armed', nextAttemptAt };
  };

  if (!question.settledAt) {
    return reArm('not_settled');
  }
  if (question.questionDate) {
    const prior = await getPriorDayDailyQuestion(db, question.questionDate);
    if (prior && prior.status !== 'revealed' && prior.status !== 'voided') {
      return reArm('prior_day_not_settled');
    }
  }

  const gradedPicks = await getGradedPicksForQuestion(db, questionId);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tx: Db = createDb(client);

    const revealResult = await revealQuestionTx(tx, questionId, at);
    if (!revealResult.revealed) {
      await client.query('ROLLBACK');
      return { status: 'noop' }; // lost a race with another instance — already revealed
    }

    let calledItCount = 0;
    let beatsWritten = 0;
    if (question.questionDate) {
      const questionDate = question.questionDate;
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

        // WS9-T3 (§13.3): derive + write this participant's reveal beats in the same transaction
        // as the reveal + streak mutation above (see header comment).
        const profile = await getProfileById(tx, gp.profileId);
        const beats = deriveRevealBeats({
          profileId: gp.profileId,
          handle: profile?.handle ?? gp.profileId,
          questionDate,
          previousStreak: streakResult.previousStreak,
          currentStreak: streakResult.currentStreak,
          freezeUsedForGap: streakResult.freezeUsedForGap,
          freezeBankAfter: streakResult.freezeBankAfter,
          calledIt,
          impliedProbability,
        });
        const outboxReport = await writeBeatsToOutbox(tx, beats, at);
        beatsWritten += outboxReport.written;

        // WS9-T4 (§13.2 "Reveal at 8"): every graded participant also gets the general reveal
        // announcement, on both channels — see header comment for the "never before revealed"
        // AC's structural guarantee.
        const generalBeat = deriveGeneralRevealBeat({ profileId: gp.profileId, questionDate, ctaUrl });
        const generalReport = await writeBeatToOutboxAllChannels(tx, generalBeat, at);
        beatsWritten += generalReport.written;
      }
    }

    if (question.questionDate) {
      const matchIds = await listOpenMatchIdsForWindowDate(tx, question.questionDate);
      for (const matchId of matchIds) {
        await tryCompleteDuoMatch(tx, matchId, at);
      }
    }

    await client.query('COMMIT');

    // Best-effort, post-commit only (never throws; ISR timer is the fallback). The reveal is
    // the P8 appointment moment — this is what makes the public page flip NOW instead of up to
    // ~ISR_REVALIDATE_QUESTION_S later.
    await requestRevalidation(questionRevalidationPaths(question.slug));

    // SPEC-GAP(WS9-T3): notification DISPATCH (notify:dispatch, actually sending email/push) is
    // WS9-T1/T2 scope — beats above are written to the outbox only.

    return { status: 'revealed', participantCount: gradedPicks.length, calledItCount, beatsWritten };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export const revealFireHandler: JobHandler = async (ctx, data) => {
  const { questionId } = data as RevealFireJobData;
  const outcome = await runRevealFire(ctx.db, ctx.pool, ctx.boss, questionId);
  logger.info({ questionId, outcome }, 'reveal:fire complete');
};
