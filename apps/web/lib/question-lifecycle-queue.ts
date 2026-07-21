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

/**
 * Topic questions (journeys plan §4, WS18-T1) are born `open` (openAt=now) and carry no
 * synchronized reveal (§D-J3: settlement follows the venue market, any time of day), so they need
 * only the ONE `question:lock` transition at `lock_at` (= the market's close_time). Without it a
 * topic would sit `open` forever and keep surfacing in the stack feed past its close (the feed
 * filters on the RAW `status='open'`). Reuses the kind-agnostic `question:lock` job the daily path
 * already relies on — it only flips `open`→`locked` and snapshots crowd/price, no daily-only logic.
 */
export async function scheduleTopicQuestionLock(question: { id: string; lockAt: Date }): Promise<void> {
  const boss = await getBoss();
  await boss.createQueue('question:lock');
  await boss.send('question:lock', { questionId: question.id }, { startAfter: question.lockAt });
}
