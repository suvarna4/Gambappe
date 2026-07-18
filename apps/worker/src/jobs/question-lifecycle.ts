/**
 * `question:open`/`question:lock` scheduling (WS3-T1, §5.3/§5.7/§6.2). These two jobs have no
 * cron (§7.6 registry: "Per-question at open_at/lock_at — scheduled sends, no cron") — they're
 * enqueued per-question with `startAfter`. No curation UI exists yet in this wave (WS10-T2), so
 * nothing currently calls `scheduleQuestionLifecycle` in production; it's the scheduler surface
 * WS10-T2 wires up when it lands. `reveal:fire` is scheduled the same way here (its target is
 * `reveal_at`; the job itself re-arms/checks settlement, §6.7) — `grade:followup` (§6.5) ALSO
 * (re-)enqueues it after grading as a robustness net for late-settling markets, so having two
 * scheduled instances is harmless (`reveal:fire` is idempotent, §5.7).
 */
import type PgBoss from 'pg-boss';
import type { QuestionRow } from '@receipts/db';

export async function scheduleQuestionLifecycle(boss: PgBoss, question: QuestionRow): Promise<void> {
  await boss.send('question:open', { questionId: question.id }, { startAfter: question.openAt });
  await boss.send('question:lock', { questionId: question.id }, { startAfter: question.lockAt });
  await boss.send('reveal:fire', { questionId: question.id }, { startAfter: question.revealAt });
}
