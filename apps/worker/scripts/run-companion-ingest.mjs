#!/usr/bin/env node
/**
 * On-demand trigger for `companion:ingest` (XH-T5, docs/xtrace-hackathon-tasks.md). The 04:00 ET
 * cron alone is useless during a live demo — T9's runbook invokes this script by path to run the
 * job immediately against a running worker. Mirrors
 * `scripts/question-zero-drill/manual-schedule.mjs`'s plain-.mjs/PgBoss-from-DATABASE_URL shape.
 *
 * Usage:
 *   node scripts/run-companion-ingest.mjs
 */
import PgBoss from 'pg-boss';

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set — point it at the worker's database first.");
  process.exit(1);
}

async function main() {
  const boss = new PgBoss({ connectionString: process.env.DATABASE_URL, schema: 'pgboss' });
  await boss.start();
  await boss.send('companion:ingest', {});
  console.log('sent companion:ingest');
  await boss.stop({ graceful: true, timeout: 5000 });
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
