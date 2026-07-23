#!/usr/bin/env node
/**
 * On-demand trigger for `companion:season-recap` (XH-T8, docs/xtrace-hackathon-tasks.md).
 * Queue-only — mirrors `run-companion-ingest.mjs`'s plain-.mjs/PgBoss-from-DATABASE_URL shape.
 * `seasonId` is OPTIONAL (omitted = "the most recently ended nemesis season"); the XH-T9 demo
 * runbook always passes it explicitly, since the demo's seeded season is still running and the
 * default "latest ended" resolution would find nothing.
 *
 * Usage:
 *   node scripts/run-season-recap.mjs [seasonId]
 */
import PgBoss from 'pg-boss';

const [seasonId] = process.argv.slice(2);

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set — point it at the worker's database first.");
  process.exit(1);
}

async function main() {
  const boss = new PgBoss({ connectionString: process.env.DATABASE_URL, schema: 'pgboss' });
  await boss.start();
  await boss.send('companion:season-recap', seasonId ? { seasonId } : {});
  console.log('sent companion:season-recap', seasonId ? { seasonId } : '(latest ended season)');
  await boss.stop({ graceful: true, timeout: 5000 });
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
