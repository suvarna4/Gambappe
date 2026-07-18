/**
 * Load-test fixture seeder (design doc §17.1 "Load (k6, WS14-T2)", §10.2, WS14-T2 row).
 *
 * Seeds a DEDICATED, disposable Postgres database directly via `@receipts/db` (bypassing HTTP
 * and the §14.1 rate limiters entirely — this is fixture setup, not the thing under test) with:
 *
 *   1. An "open" daily question ("the viral card") with `open_at` in the past and `lock_at`/
 *      `reveal_at` far enough in the future to stay `open` for the whole run — target for the
 *      spectator-page burst scenario (`scenarios/spectator-burst.js`).
 *   2. A "revealed" daily question with `LOAD_TEST_REVEAL_VUS` (default 500, matching the
 *      WS14-T2 row's "500 concurrent clients") graded picks, each belonging to a distinct ghost
 *      profile with a REAL `rcpt_gid` cookie valid against `GHOST_COOKIE_SECRET` (§6.1.1's
 *      scheme, reused from `apps/web/lib/ghost-cookie.ts` — not reimplemented here) — target
 *      for the reveal-minute concurrency scenario (`scenarios/reveal-minute-spike.js`:
 *      `GET /me` + `GET /questions/:slug/reveal`).
 *   3. Pre-warms the Redis reveal-percentile cache (`reveal:{questionId}`, §8.6 — the same
 *      cache `apps/web/lib/percentile.ts` reads) so the burst measures steady-state latency,
 *      not one unlucky VU eating a cold-cache full-table scan that every other request would
 *      otherwise avoid.
 *
 * Writes `.fixtures/load-test-fixture.json` (gitignored) for the k6 scripts to `open()`.
 *
 * DESTRUCTIVE + idempotent: wipes ghost profiles/questions/markets/picks in whatever
 * `DATABASE_URL` points at before reseeding, so it can be re-run freely without accumulating
 * cruft or hitting unique-constraint collisions. Refuses to run unless the database name
 * contains "load" (a dedicated `receipts_load_*` database, per this task's PR description) —
 * this is a deliberate guard against ever pointing a wipe-and-reseed script at a shared dev,
 * CI, staging, or prod database by mistake.
 *
 * Usage:
 *   DATABASE_URL=postgres://receipts:receipts@localhost:5432/receipts_load_ws14t2 \
 *   REDIS_URL=redis://localhost:6379/14 \
 *   GHOST_COOKIE_SECRET=load-test-ghost-cookie-secret \
 *   LOAD_TEST_REVEAL_VUS=500 \
 *   pnpm --filter web run load-test:seed
 */
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { computePercentiles } from '@receipts/core';
import {
  connect,
  getGradedPickScoresForQuestion,
  markets,
  picks,
  profiles,
  questions,
} from '@receipts/db';
import { buildMarket, buildProfile, buildQuestion, computeEdge } from '@receipts/db/testing';
import {
  GHOST_COOKIE_NAME,
  buildGhostCookieValue,
  generateGhostSecret,
  hashGhostSecret,
} from '@/lib/ghost-cookie';
import { revealHashKey } from '@/lib/percentile';

const REVEAL_VUS = Number(process.env['LOAD_TEST_REVEAL_VUS'] ?? 500);
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '.fixtures');
const OUT_FILE = join(OUT_DIR, 'load-test-fixture.json');

function assertDisposableDatabase(): void {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error("DATABASE_URL is not set — see this file's header comment");
  let dbName: string;
  try {
    dbName = new URL(url).pathname.replace(/^\//, '');
  } catch {
    throw new Error(`DATABASE_URL is not a valid connection string: ${url}`);
  }
  if (!dbName.includes('load')) {
    throw new Error(
      `refusing to run the destructive load-test seeder against database "${dbName}" — ` +
        `DATABASE_URL must point at a dedicated, disposable database whose name contains ` +
        `"load" (e.g. receipts_load_ws14t2). This guard exists so this script can never wipe ` +
        `a shared dev/CI/staging/prod database.`,
    );
  }
}

/** day offset far from any realistic seeded/E2E data (other factories cluster around
 * 2026-01-02+ and today's real date) — collision-proof in practice even without the wipe step. */
function farFutureDateString(daysFromEpoch2030: number): string {
  const base = new Date('2030-01-01T00:00:00Z');
  base.setUTCDate(base.getUTCDate() + daysFromEpoch2030);
  return base.toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  assertDisposableDatabase();

  const redisUrl = process.env['REDIS_URL'];
  if (!redisUrl) throw new Error("REDIS_URL is not set — see this file's header comment");
  if (!process.env['GHOST_COOKIE_SECRET']) {
    throw new Error('GHOST_COOKIE_SECRET is not set — must match the value `next start` runs with');
  }

  const { pool, db } = connect();
  const redis = new Redis(redisUrl);

  try {
    console.log('wiping previous load-test data (ghost profiles / questions / markets / picks)...');
    // FK-ordered; ghost-only so any WS0-T3 seed data (admin user, placement items) is untouched.
    await db.execute(sql`DELETE FROM picks`);
    await db.execute(sql`DELETE FROM questions`);
    await db.execute(sql`DELETE FROM markets`);
    await db.execute(sql`DELETE FROM profiles WHERE kind = 'ghost'`);
    await redis.flushdb();

    const now = new Date();
    const dayA = randomInt(0, 100_000);
    const dayB = randomInt(0, 100_000);
    const slugSuffix = randomBytes(4).toString('hex');

    // --- 1. Spectator burst target: an OPEN "viral card" question -----------------------------
    const spectatorMarket = buildMarket({ status: 'open' });
    const spectatorQuestion = buildQuestion(spectatorMarket.id as string, {
      questionDate: farFutureDateString(dayA),
      slug: `load-test-spectator-${slugSuffix}`,
      headline: 'Will the load test finish under threshold?',
      status: 'open',
      openAt: new Date(now.getTime() - 60 * 60_000), // opened 1h ago
      lockAt: new Date(now.getTime() + 12 * 60 * 60_000), // locks in 12h — stays open for the run
      revealAt: new Date(now.getTime() + 20 * 60 * 60_000),
    });
    await db.insert(markets).values(spectatorMarket);
    await db.insert(questions).values(spectatorQuestion);
    console.log(`seeded spectator question: /q/${spectatorQuestion.slug}`);

    // --- 2. Reveal-minute spike target: a REVEALED question + REVEAL_VUS graded picks ---------
    const revealMarket = buildMarket({ status: 'resolved', outcome: 'yes' });
    const revealedAt = new Date(now.getTime() - 60_000); // revealed 1 minute ago
    const revealQuestion = buildQuestion(revealMarket.id as string, {
      questionDate: farFutureDateString(dayB),
      slug: `load-test-reveal-${slugSuffix}`,
      headline: 'Did the reveal-minute spike hold the DB pool?',
      status: 'revealed',
      openAt: new Date(now.getTime() - 20 * 60 * 60_000),
      lockAt: new Date(now.getTime() - 12 * 60 * 60_000),
      revealAt: revealedAt,
      revealedAt,
      settledAt: new Date(now.getTime() - 5 * 60_000),
      outcome: 'yes',
      crowdYesAtLock: Math.round(REVEAL_VUS * 0.6),
      crowdNoAtLock: REVEAL_VUS - Math.round(REVEAL_VUS * 0.6),
      yesPriceAtLock: 0.6,
    });
    await db.insert(markets).values(revealMarket);
    await db.insert(questions).values(revealQuestion);

    console.log(
      `seeding ${REVEAL_VUS} ghost profiles + graded picks on /q/${revealQuestion.slug}...`,
    );
    const ghosts: Array<{ profileId: string; cookie: string }> = [];
    const BATCH = 100;
    for (let start = 0; start < REVEAL_VUS; start += BATCH) {
      const end = Math.min(start + BATCH, REVEAL_VUS);
      const batchProfiles: (typeof profiles.$inferInsert)[] = [];
      const batchPicks: (typeof picks.$inferInsert)[] = [];
      for (let i = start; i < end; i++) {
        const secret = generateGhostSecret();
        const profile = buildProfile({
          ghostSecretHash: hashGhostSecret(secret),
          lastSeenAt: now,
        });
        batchProfiles.push(profile);
        ghosts.push({
          profileId: profile.id as string,
          cookie: `${GHOST_COOKIE_NAME}=${buildGhostCookieValue(profile.id as string, secret)}`,
        });

        // ~60/40 win/loss split matching crowdYesAtLock above.
        const side: 'yes' | 'no' = i % 5 < 3 ? 'yes' : 'no';
        const won = side === 'yes'; // outcome is 'yes'
        const yesPriceAtEntry = 0.55 + (i % 10) / 100; // some spread, all plausible entry prices
        batchPicks.push({
          id: randomUUID(),
          questionId: revealQuestion.id as string,
          profileId: profile.id as string,
          side,
          yesPriceAtEntry,
          priceStampedAt: revealQuestion.openAt as Date,
          pickedAt: new Date((revealQuestion.openAt as Date).getTime() + 60_000),
          source: 'web',
          result: won ? 'win' : 'loss',
          edge: computeEdge(side, yesPriceAtEntry, won),
          gradedAt: revealQuestion.settledAt as Date,
        });
      }
      await db.insert(profiles).values(batchProfiles);
      await db.insert(picks).values(batchPicks);
      console.log(`  ...${end}/${REVEAL_VUS}`);
    }

    // --- 3. Pre-warm the reveal percentile cache (§8.6) so the burst hits a warm cache, same as
    // it would in prod (the worker's `percentiles` job runs before clients start polling). -----
    const entries = await getGradedPickScoresForQuestion(db, revealQuestion.id as string);
    const pcts = computePercentiles(entries.map((e) => e.edge));
    const fields: Record<string, string> = {};
    entries.forEach((e, i) => {
      fields[e.profileId] = String(pcts[i]);
    });
    await redis.hset(revealHashKey(revealQuestion.id as string), fields);
    console.log(`pre-warmed percentile cache for ${entries.length} graded picks`);

    await mkdir(OUT_DIR, { recursive: true });
    await writeFile(
      OUT_FILE,
      JSON.stringify(
        {
          generatedAt: now.toISOString(),
          spectatorQuestionSlug: spectatorQuestion.slug,
          revealQuestionSlug: revealQuestion.slug,
          ghosts,
        },
        null,
        2,
      ),
    );
    console.log(`wrote fixture: ${OUT_FILE}`);
  } finally {
    await redis.quit();
    await pool.end();
  }
}

await main();
