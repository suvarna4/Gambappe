#!/usr/bin/env node
/**
 * Question Zero drill, step 6: "settle via mock" (design doc WS14-T4 AC) without needing real
 * venue credentials. `apps/worker`'s `settlement:poll` (apps/worker/src/jobs/settlement-poll.ts)
 * asks a VenueAdapter for `getResolution()` and, once it reports `resolved`, calls
 * `gradeResolvedQuestionTx` then transactionally enqueues `grade:followup`. This script skips
 * the "ask an adapter" step (there's no live venue to ask) and calls the SAME
 * `gradeResolvedQuestionTx` repository function directly with the outcome you supply, then
 * enqueues `grade:followup` for the live worker to pick up — functionally equivalent to
 * settlement:poll observing a MockVenueAdapter resolve, minus the transactional-enqueue
 * fidelity (fine for a manual drill; see the launch-drill runbook's timing log for a run that
 * went through the real `runSettlementPoll` with an injected MockVenueAdapter for full fidelity).
 *
 * Usage:
 *   node scripts/question-zero-drill/settle-via-mock.mjs <questionId> <yes|no>
 */
import PgBoss from 'pg-boss';
import { connect, createDb, gradeResolvedQuestionTx } from '@receipts/db';

const [questionId, outcome] = process.argv.slice(2);
if (!questionId || (outcome !== 'yes' && outcome !== 'no')) {
  console.error('usage: node settle-via-mock.mjs <questionId> <yes|no>');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set — point it at your disposable drill database first.');
  process.exit(1);
}

async function main() {
  const { pool } = connect();
  const boss = new PgBoss({ connectionString: process.env.DATABASE_URL, schema: 'pgboss' });
  await boss.start();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tx = createDb(client);
    const result = await gradeResolvedQuestionTx(tx, questionId, outcome, new Date());
    if (!result.graded) {
      await client.query('ROLLBACK');
      console.log('not graded (question not locked, or already settled) — nothing to do', result);
      return;
    }
    await client.query(
      "insert into pgboss.job (name, data) values ('grade:followup', $1)",
      [JSON.stringify({ questionId })],
    );
    await client.query('COMMIT');
    console.log('graded via mock settlement:', result, '— grade:followup enqueued');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  await boss.stop({ graceful: true, timeout: 5000 });
  await pool.end();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
