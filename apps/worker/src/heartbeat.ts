/**
 * Heartbeat wrapper (§15.5, §19.4 rule 4): every job handler records start/success/failure
 * into job_heartbeats. Failures re-throw so pg-boss retry/dead-letter behavior is untouched.
 */
import { now } from '@receipts/core';
import { recordJobFailure, recordJobStart, recordJobSuccess } from '@receipts/db';
import type { JobContext } from './context.js';
import { logger } from './logger.js';

export type JobHandler = (ctx: JobContext, data: unknown) => Promise<void>;

export function withHeartbeat(jobName: string, handler: JobHandler): JobHandler {
  return async (ctx, data) => {
    await recordJobStart(ctx.db, jobName, now()).catch((err) =>
      logger.warn({ jobName, err }, 'failed to record job start heartbeat'),
    );
    try {
      await handler(ctx, data);
      await recordJobSuccess(ctx.db, jobName, now()).catch((err) =>
        logger.warn({ jobName, err }, 'failed to record job success heartbeat'),
      );
    } catch (err) {
      await recordJobFailure(ctx.db, jobName, now(), err).catch(() => {});
      throw err;
    }
  };
}
