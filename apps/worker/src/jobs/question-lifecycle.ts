/**
 * `question:open`/`question:lock` scheduling (WS3-T1, §5.3/§5.7/§6.2). These two jobs have no
 * cron (§7.6 registry: "Per-question at open_at/lock_at — scheduled sends, no cron") — they're
 * enqueued per-question with `startAfter`. No curation UI exists yet in this wave (WS10-T2), so
 * nothing currently calls `scheduleQuestionLifecycle` in production; it's the scheduler surface
 * WS10-T2 wires up when it lands.
 *
 * WS19-T1 (D-J3): the third `reveal:fire` send is GONE. The synchronized clock-scheduled reveal
 * ceremony is cut — a daily settles the moment its venue market resolves, in the same tick as
 * grading (`grade:followup` → `settleQuestion`), not on a per-question `reveal_at` clock. Nothing
 * fires reveals by clock anymore, so there is no reveal job to pre-schedule here.
 */
import type PgBoss from 'pg-boss';
import type { QuestionRow } from '@receipts/db';

export async function scheduleQuestionLifecycle(boss: PgBoss, question: QuestionRow): Promise<void> {
  await boss.send('question:open', { questionId: question.id }, { startAfter: question.openAt });
  await boss.send('question:lock', { questionId: question.id }, { startAfter: question.lockAt });
}
