/**
 * `settlement:poll` (WS1-T5; §6.5, §7.5 every 5 min): for each `locked` question, asks the
 * venue adapter for `getResolution`. On `resolved`: grades in ONE transaction (outcome +
 * settledAt copy, pending picks → win/loss/edge) and enqueues `grade:followup` inside that
 * SAME transaction. On `voided`: question → voided, pending picks → void/null, same
 * transaction. On `unresolved`: no-op, retried next tick. Every path is idempotent — a
 * question stays `status='locked'` through grading (the `'locked'→'revealed'` transition is
 * WS3-T4's `reveal:fire`, per the §6.5 publication rule), so this job keeps re-polling
 * already-graded questions harmlessly until reveal fires; the repo-layer guards
 * (`settled_at IS NULL` / `status='locked'`) make every re-run a no-op.
 *
 * Transactional enqueue: pg-boss (v10) accepts a connection override — `send(name, data,
 * {db: {executeSql}})` — that runs the job insert through whatever `executeSql` is given
 * (`packages/venues`-external, verified against `node_modules/pg-boss/src/manager.js`:
 * `const db = options.db || this.db`). Passing the SAME `pg.PoolClient` used for the Drizzle
 * transaction makes the enqueue commit/rollback atomically with the grading writes — true
 * transactional enqueue, not a "send right after commit" approximation.
 */
import type PgBoss from 'pg-boss';
import type pg from 'pg';
import { now } from '@receipts/core';
import type { VenueAdapter } from '@receipts/venues';
import {
  createDb,
  gradeResolvedQuestionTx,
  listLockedQuestionsForSettlement,
  voidQuestionTx,
  type Db,
  type LockedQuestionForSettlement,
} from '@receipts/db';
import type { JobHandler } from '../heartbeat.js';
import { logger } from '../logger.js';
import { defaultVenueAdapters } from '../venues.js';

type SettleOutcome = 'resolved' | 'already-graded' | 'voided' | 'unresolved' | 'error';

async function settleOne(
  pool: pg.Pool,
  boss: PgBoss,
  lq: LockedQuestionForSettlement,
  adapter: VenueAdapter,
  at: Date,
): Promise<SettleOutcome> {
  let resolution;
  try {
    resolution = await adapter.getResolution(lq.venueMarketId);
  } catch (err) {
    logger.warn(
      { err, questionId: lq.questionId, venue: lq.venue },
      'settlement:poll getResolution failed',
    );
    return 'error';
  }
  if (resolution.state === 'unresolved') return 'unresolved';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tx: Db = createDb(client);

    if (resolution.state === 'resolved') {
      const result = await gradeResolvedQuestionTx(tx, lq.questionId, resolution.outcome, at);
      if (result.graded) {
        await boss.send(
          'grade:followup',
          { questionId: lq.questionId },
          {
            db: { executeSql: (text: string, values: unknown[]) => client.query(text, values) },
          },
        );
      }
      await client.query('COMMIT');
      return result.graded ? 'resolved' : 'already-graded';
    }

    const voidResult = await voidQuestionTx(tx, lq.questionId, at);
    await client.query('COMMIT');
    return voidResult.voided ? 'voided' : 'already-graded';
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error({ err, questionId: lq.questionId }, 'settlement:poll grading transaction failed');
    return 'error';
  } finally {
    client.release();
  }
}

export interface SettlementPollReport {
  checked: number;
  resolved: number;
  voided: number;
  unresolved: number;
  alreadyGraded: number;
  errors: number;
}

export async function runSettlementPoll(
  db: Db,
  pool: pg.Pool,
  boss: PgBoss,
  adapters: VenueAdapter[] = defaultVenueAdapters(),
  at: Date = now(),
): Promise<SettlementPollReport> {
  const report: SettlementPollReport = {
    checked: 0,
    resolved: 0,
    voided: 0,
    unresolved: 0,
    alreadyGraded: 0,
    errors: 0,
  };
  const lockedQuestions = await listLockedQuestionsForSettlement(db);
  report.checked = lockedQuestions.length;
  const adapterByVenue = new Map(adapters.map((a) => [a.venue, a]));

  for (const lq of lockedQuestions) {
    const adapter = adapterByVenue.get(lq.venue as VenueAdapter['venue']);
    if (!adapter) {
      report.errors++;
      continue;
    }
    const outcome = await settleOne(pool, boss, lq, adapter, at);
    switch (outcome) {
      case 'resolved':
        report.resolved++;
        break;
      case 'voided':
        report.voided++;
        break;
      case 'unresolved':
        report.unresolved++;
        break;
      case 'already-graded':
        report.alreadyGraded++;
        break;
      case 'error':
        report.errors++;
        break;
    }
  }
  return report;
}

export const settlementPollHandler: JobHandler = async (ctx) => {
  const report = await runSettlementPoll(ctx.db, ctx.pool, ctx.boss);
  logger.info({ report }, 'settlement:poll complete');
};
