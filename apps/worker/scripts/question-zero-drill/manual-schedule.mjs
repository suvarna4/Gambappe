#!/usr/bin/env node
/**
 * Question Zero drill, step 4 (workaround for the "Known gap" in docs/runbooks/launch-drill.md):
 * POST /api/admin/questions does not enqueue the per-question lifecycle jobs, so a curated
 * question sits in `status='scheduled'` forever with no live worker fixing that. This script
 * enqueues the exact same three jobs, byte-for-byte matching
 * apps/worker/src/jobs/question-lifecycle.ts's scheduleQuestionLifecycle(), so the rest of the
 * open → lock → settle → reveal pipeline can still be exercised against the live worker while
 * that gap is open. Delete this step from the drill once the composer schedules these itself.
 *
 * Usage:
 *   node scripts/question-zero-drill/manual-schedule.mjs <questionId> <openAtIso> <lockAtIso> <revealAtIso>
 */
import PgBoss from 'pg-boss';

const [questionId, openAt, lockAt, revealAt] = process.argv.slice(2);
if (!questionId || !openAt || !lockAt || !revealAt) {
  console.error(
    'usage: node manual-schedule.mjs <questionId> <openAtIso> <lockAtIso> <revealAtIso>',
  );
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set — point it at your disposable drill database first.');
  process.exit(1);
}

async function main() {
  const boss = new PgBoss({ connectionString: process.env.DATABASE_URL, schema: 'pgboss' });
  await boss.start();
  await boss.send('question:open', { questionId }, { startAfter: new Date(openAt) });
  await boss.send('question:lock', { questionId }, { startAfter: new Date(lockAt) });
  await boss.send('reveal:fire', { questionId }, { startAfter: new Date(revealAt) });
  console.log('scheduled question:open / question:lock / reveal:fire for', questionId, {
    openAt,
    lockAt,
    revealAt,
  });
  await boss.stop({ graceful: true, timeout: 5000 });
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
