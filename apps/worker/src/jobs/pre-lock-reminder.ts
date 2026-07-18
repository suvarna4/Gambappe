/**
 * `notify:pre-lock-reminder` (WS9-T4, §13.2/§19.3: "pre-lock reminder for streak holders").
 * Cron every 5 minutes (`registry.ts`). For every `open` daily question whose `lock_at` is
 * within `PRE_LOCK_REMINDER_LEAD_MIN` minutes (and hasn't passed — `question:lock` flips status
 * before this job would ever see a locked row as still-open, §5.7 effective-state rule), finds
 * "streak holder" profiles (`current_streak > 0`, same criterion `streak:sweep` already uses to
 * decide who has something to lose from a gap day — `listPreLockReminderCandidates`) who have
 * NOT yet placed a pick on that question, and writes a `reveal_reminder` beat to both channels
 * (`write-multi-channel-outbox.ts`).
 *
 * Idempotent under redelivery/repeated ticks (§19.4 rule 4): `dedupe_key` is
 * `reveal_reminder:{questionDate}:{profileId}:{channel}` (`pre-lock-reminder-beat.ts` +
 * `write-multi-channel-outbox.ts`). A profile who still hasn't picked keeps re-qualifying as a
 * candidate on every 5-minute tick inside the lead window — that's fine BY DESIGN: dedupe_key's
 * unique constraint (§5.6) makes every re-evaluation after the first a silent no-op, so this job
 * needs no watermark/self-exclusion column the way `streak:freeze-grant` needs
 * `last_freeze_grant_week` — "already sent" is fully derivable from the outbox itself.
 *
 * No transaction wrapping: unlike `streak:sweep`/`streak:freeze-grant` (which mutate `profiles`
 * state and need a tx per candidate to stay crash-safe), this job only INSERTs into
 * `notifications`, and `sendNotification`'s `ON CONFLICT DO NOTHING` is already atomic per row
 * (matching `write-outbox.ts`/`writeBeatsToOutbox`'s own no-transaction precedent).
 */
import { PRE_LOCK_REMINDER_LEAD_MIN, now } from '@receipts/core';
import { listOpenQuestionsWithLockWithin, listPreLockReminderCandidates, type Db } from '@receipts/db';
import type { JobHandler } from '../heartbeat.js';
import { logger } from '../logger.js';
import { buildQuestionUrl } from '../lib/question-url.js';
import { derivePreLockReminderBeat } from '../notifications/pre-lock-reminder-beat.js';
import { writeBeatToOutboxAllChannels } from '../notifications/write-multi-channel-outbox.js';

export interface PreLockReminderReport {
  questionsChecked: number;
  candidatesFound: number;
  written: number;
  deduped: number;
}

export async function runPreLockReminder(db: Db, at: Date = now()): Promise<PreLockReminderReport> {
  const report: PreLockReminderReport = { questionsChecked: 0, candidatesFound: 0, written: 0, deduped: 0 };

  const dueQuestions = await listOpenQuestionsWithLockWithin(db, at, PRE_LOCK_REMINDER_LEAD_MIN);
  report.questionsChecked = dueQuestions.length;

  for (const question of dueQuestions) {
    // "Streak holder" is a daily-participation concept (§6.6) — non-daily (kind='special')
    // questions have no question_date and don't feed the streak, so skip them.
    if (question.kind !== 'daily' || !question.questionDate) continue;
    const questionDate = question.questionDate;
    const ctaUrl = buildQuestionUrl(question.slug);

    const candidates = await listPreLockReminderCandidates(db, question.id);
    report.candidatesFound += candidates.length;

    for (const candidate of candidates) {
      const beat = derivePreLockReminderBeat({
        profileId: candidate.profileId,
        questionDate,
        currentStreak: candidate.currentStreak,
        ctaUrl,
      });
      const result = await writeBeatToOutboxAllChannels(db, beat, at);
      report.written += result.written;
      report.deduped += result.deduped;
    }
  }

  return report;
}

export const preLockReminderHandler: JobHandler = async (ctx) => {
  const report = await runPreLockReminder(ctx.db);
  logger.info({ report }, 'notify:pre-lock-reminder complete');
};
