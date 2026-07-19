/**
 * Enqueues the `question:open`/`question:lock`/`reveal:fire` scheduling for a newly-curated
 * daily question (§5.3/§5.7/§6.2, jobs owned by `apps/worker/src/jobs/question-lifecycle.ts`'s
 * `scheduleQuestionLifecycle`). `apps/web` can't import that function directly — it lives in the
 * `apps/worker` app, not a shared package — so this mirrors its three `boss.send` calls exactly,
 * following the same cross-process enqueue pattern `wallet-queue.ts`/`settlement-admin.ts`
 * already establish: `createQueue` defensively before `send` (idempotent, `ON CONFLICT DO
 * NOTHING`) so this never depends on `apps/worker` having already booted and registered the
 * queue first.
 */
import { getBoss } from './stores';

export interface ScheduledQuestionTimes {
  id: string;
  openAt: Date;
  lockAt: Date;
  revealAt: Date;
}

export async function scheduleDailyQuestionLifecycle(question: ScheduledQuestionTimes): Promise<void> {
  const boss = await getBoss();
  await boss.createQueue('question:open');
  await boss.createQueue('question:lock');
  await boss.createQueue('reveal:fire');
  await boss.send('question:open', { questionId: question.id }, { startAfter: question.openAt });
  await boss.send('question:lock', { questionId: question.id }, { startAfter: question.lockAt });
  await boss.send('reveal:fire', { questionId: question.id }, { startAfter: question.revealAt });
}
