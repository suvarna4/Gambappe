/**
 * `question:open` (WS3-T1, §5.3/§5.7): `scheduled` → `open`. Fired once per question at
 * `open_at`. Idempotent — a redelivered/duplicate job is a no-op (`openQuestionTx` only
 * transitions from `scheduled`).
 */
import type pg from 'pg';
import { now } from '@receipts/core';
import { createDb, openQuestionTx, type Db, type OpenQuestionResult } from '@receipts/db';
import type { JobHandler } from '../heartbeat.js';
import { logger } from '../logger.js';

export interface QuestionOpenJobData {
  questionId: string;
}

export async function runQuestionOpen(
  pool: pg.Pool,
  questionId: string,
  at: Date = now(),
): Promise<OpenQuestionResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tx: Db = createDb(client);
    const result = await openQuestionTx(tx, questionId, at);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export const questionOpenHandler: JobHandler = async (ctx, data) => {
  const { questionId } = data as QuestionOpenJobData;
  const result = await runQuestionOpen(ctx.pool, questionId);
  logger.info({ questionId, ...result }, 'question:open complete');
};
