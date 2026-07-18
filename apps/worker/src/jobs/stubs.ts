/**
 * Job stubs (WS0-T4): every §7.6 job exists in the registry from day one so cron wiring,
 * heartbeats, and ops dashboards are real; owning workstreams replace the bodies.
 * Stubs log-and-succeed — an unimplemented job must not dead-letter the queue.
 */
import type { JobHandler } from '../heartbeat.js';
import { logger } from '../logger.js';

export function stubHandler(jobName: string, ownerTask: string): JobHandler {
  return async (_ctx, _data) => {
    logger.info({ jobName, ownerTask }, 'job stub executed (implementation owned by %s)', ownerTask);
  };
}
