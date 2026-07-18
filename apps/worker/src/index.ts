/**
 * apps/worker boot (WS0-T4; §2.2): the single long-lived pg-boss process. Registers every
 * §7.6 job queue + cron and wraps all handlers with heartbeats. The ONLY process that calls
 * venue APIs (once WS1 lands).
 */
import PgBoss from 'pg-boss';
import { connect } from '@receipts/db';
import { withHeartbeat } from './heartbeat.js';
import type { JobContext } from './context.js';
import { logger } from './logger.js';
import { JOB_REGISTRY, SCHEDULE_TIMEZONE } from './registry.js';

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set (see .env.example)');

  const { pool, db } = connect({ connectionString });
  const boss = new PgBoss({
    connectionString,
    schema: 'pgboss',
  });
  boss.on('error', (err) => logger.error({ err }, 'pg-boss error'));

  await boss.start();
  const ctx: JobContext = { db, pool, boss };

  for (const job of JOB_REGISTRY) {
    await boss.createQueue(job.name);
    const handler = withHeartbeat(job.name, job.handler);
    await boss.work(job.name, { batchSize: 1 }, async ([pgBossJob]) => {
      await handler(ctx, pgBossJob?.data);
    });
    if (job.cron) {
      await boss.schedule(job.name, job.cron, undefined, { tz: SCHEDULE_TIMEZONE });
      logger.info({ job: job.name, cron: job.cron, tz: SCHEDULE_TIMEZONE }, 'cron registered');
    } else {
      logger.info({ job: job.name }, 'queue registered (no cron — enqueued on demand)');
    }
  }

  logger.info({ jobs: JOB_REGISTRY.length }, 'worker booted');

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    try {
      await boss.stop({ graceful: true, timeout: 10_000 });
      await pool.end();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.fatal({ err }, 'worker failed to boot');
  process.exit(1);
});
