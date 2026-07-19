/**
 * SW9-T3 (obituary-handoff §3.3(2), §4): `loadReceiptOg`'s honest busted-streak binding against
 * real Postgres — the pick renders the obituary variant iff it is the FINAL ANSWERED pick of a
 * COMPLETED run ≥ `OBITUARY_MIN_STREAK`, derived by the §6.6 replay over really-seeded history.
 * No hand-faked payloads and no profile-streak-field shortcuts where the replay should decide:
 * live `current_streak`/`best_streak` are seeded to the values `streak:sweep` would genuinely
 * leave (which is exactly the state the OLD heuristic misread), and the replay must still get
 * every case right. Route-level renders drive the real `/api/og/receipt/[pickId]` handler.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Redis } from 'ioredis';
import type pg from 'pg';
import {
  connect,
  markets,
  picks,
  profiles,
  questions,
  streakFreezeUses,
  type Db,
} from '@receipts/db';
import { buildMarket, buildPick, buildProfile, buildQuestion, computeEdge } from '@receipts/db/testing';
import { loadReceiptOg } from '@/lib/og/entities';

const dbUrl =
  process.env.TEST_DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts_test';
const redisUrl = process.env.TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6379';

let pool: pg.Pool;
let db: Db;
let redis: Redis;

beforeAll(async () => {
  ({ pool, db } = connect({ connectionString: dbUrl }));
  await db.execute(sql`DROP SCHEMA public CASCADE`);
  await db.execute(sql`CREATE SCHEMA public`);
  await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  await migrate(db, {
    migrationsFolder: join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'packages', 'db', 'drizzle'),
  });
  redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });

  process.env.DATABASE_URL = dbUrl;
  process.env.REDIS_URL = redisUrl;
  process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000';
});

afterAll(async () => {
  await pool.end();
  redis.disconnect();
});

beforeEach(async () => {
  // Each case seeds its own COMPLETE daily history: the replay walks every settled daily, so a
  // stray revealed day left over from another test would count as a run-killing miss.
  await db.execute(sql`TRUNCATE picks, questions, markets, profiles, streak_freeze_uses CASCADE`);
  await redis.flushdb();
});

interface SeededDay {
  question: ReturnType<typeof buildQuestion>;
  pick: ReturnType<typeof buildPick> | null;
}

/**
 * One settled daily for `date` (outcome YES unless voided): `side: 'yes'` wins, `side: 'no'`
 * loses; no `side` = the profile missed the day. Mirrors `broken-run-payload.test.ts`.
 */
async function seedDay(
  profileId: string,
  date: string,
  opts: { side?: 'yes' | 'no'; entry?: number; voided?: boolean } = {},
): Promise<SeededDay> {
  const market = buildMarket({ status: 'resolved', outcome: 'yes' });
  await db.insert(markets).values(market);
  const settledAt = new Date(`${date}T17:00:00Z`);
  const question = buildQuestion(market.id as string, {
    questionDate: date,
    slug: `${date}-binding-day`,
    status: opts.voided ? 'voided' : 'revealed',
    outcome: opts.voided ? null : 'yes',
    settledAt: opts.voided ? null : settledAt,
    revealedAt: opts.voided ? null : new Date(`${date}T20:00:00Z`),
    voidReason: opts.voided ? 'test void' : null,
    crowdYesAtLock: 1,
    crowdNoAtLock: 1,
  });
  await db.insert(questions).values(question);

  let pick: ReturnType<typeof buildPick> | null = null;
  if (opts.side) {
    const entry = opts.entry ?? 0.5;
    const won = opts.side === 'yes';
    pick = buildPick(question.id as string, profileId, {
      side: opts.side,
      yesPriceAtEntry: entry,
      result: opts.voided ? 'void' : won ? 'win' : 'loss',
      edge: opts.voided ? null : computeEdge(opts.side, entry, won),
      gradedAt: opts.voided ? null : settledAt,
    });
    await db.insert(picks).values(pick);
  }
  return { question, pick };
}

/** A profile whose LIVE streak fields look exactly as `streak:sweep` leaves them after a break
 * — the state the retired heuristic used to misread. The replay must not care. */
async function insertSweptProfile(bestStreak: number): Promise<string> {
  const profile = buildProfile({ currentStreak: 0, bestStreak });
  await db.insert(profiles).values(profile);
  return profile.id as string;
}

/** Drives the REAL OG receipt route (rate limit → load → ?v= guard → satori render). */
async function ogReceiptGet(pickId: string, v?: string): Promise<Response> {
  const { GET } = await import('../../app/api/og/receipt/[pickId]/route.js');
  const url = `http://localhost/api/og/receipt/${pickId}${v ? `?v=${v}` : ''}`;
  const request = new Request(url, { headers: { 'x-forwarded-for': '203.0.113.77' } });
  return GET(request, { params: Promise.resolve({ pickId }) });
}

describe('loadReceiptOg busted-streak binding (SW9-T3)', () => {
  it('a WIN pick that ended a >=3 run gets the tombstone — variant, real run fields, and a real PNG render', async () => {
    const profileId = await insertSweptProfile(3);
    await seedDay(profileId, '2026-03-01', { side: 'yes', entry: 0.6 });
    await seedDay(profileId, '2026-03-02', { side: 'no', entry: 0.75 }); // a loss mid-run
    const death = await seedDay(profileId, '2026-03-03', { side: 'yes', entry: 0.29 }); // a WIN
    await seedDay(profileId, '2026-03-04'); // uncovered miss — the run dies holding the win

    const loaded = await loadReceiptOg(db, death.pick!.id as string);
    expect(loaded).not.toBeNull();
    expect(loaded!.data.pick.result).toBe('win'); // the say-it-out-loud case: a WIN tombstone
    expect(loaded!.data.variant).toBe('busted_streak');
    expect(loaded!.data.bustedRun).toEqual({
      length: 3,
      startedOn: '2026-03-01',
      endedOn: '2026-03-03',
    });

    const res = await ogReceiptGet(death.pick!.id as string, loaded!.hash);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
  });

  it('already-circulating pre-death links 302 onto the tombstone render (?v= guard, intended)', async () => {
    const profileId = await insertSweptProfile(3);
    await seedDay(profileId, '2026-03-01', { side: 'yes' });
    await seedDay(profileId, '2026-03-02', { side: 'yes' });
    const death = await seedDay(profileId, '2026-03-03', { side: 'yes' });

    // The link that circulated while the streak was alive: a plain WIN receipt hash.
    const preDeath = await loadReceiptOg(db, death.pick!.id as string);
    expect(preDeath!.data.variant).toBe('win');

    await seedDay(profileId, '2026-03-04'); // the miss lands; the run is now dead

    const postDeath = await loadReceiptOg(db, death.pick!.id as string);
    expect(postDeath!.data.variant).toBe('busted_streak');
    expect(postDeath!.hash).not.toBe(preDeath!.hash); // binding is a §10.5 hash input

    // The stale circulating URL is never rendered — it redirects to the canonical tombstone.
    const res = await ogReceiptGet(death.pick!.id as string, preDeath!.hash);
    expect(res.status).toBe(302);
    expect(new URL(res.headers.get('location')!).searchParams.get('v')).toBe(postDeath!.hash);
  });

  it("a MID-RUN loss does NOT render busted — the old heuristic's false positive (loss + live streak fields zeroed)", async () => {
    const profileId = await insertSweptProfile(3);
    await seedDay(profileId, '2026-03-01', { side: 'yes' });
    const midRunLoss = await seedDay(profileId, '2026-03-02', { side: 'no', entry: 0.7 });
    await seedDay(profileId, '2026-03-03', { side: 'yes' });
    await seedDay(profileId, '2026-03-04'); // the run dies AFTER the loss, holding the day-3 win

    // Old heuristic: result=loss && profile.current_streak=0 && best>=1 → busted. Wrong pick.
    const loaded = await loadReceiptOg(db, midRunLoss.pick!.id as string);
    expect(loaded!.data.variant).toBe('loss');
    expect(loaded!.data.bustedRun).toBeNull();
  });

  it('a loss with an intact (live) run stays a plain loss — no completed run, no tombstone', async () => {
    const profile = buildProfile({ currentStreak: 3, bestStreak: 3 });
    await db.insert(profiles).values(profile);
    const profileId = profile.id as string;
    await seedDay(profileId, '2026-03-01', { side: 'yes' });
    await seedDay(profileId, '2026-03-02', { side: 'yes' });
    const loss = await seedDay(profileId, '2026-03-03', { side: 'no', entry: 0.3 });

    const loaded = await loadReceiptOg(db, loss.pick!.id as string);
    expect(loaded!.data.variant).toBe('loss');
    expect(loaded!.data.bustedRun).toBeNull();
  });

  it('a short (<OBITUARY_MIN_STREAK) dead run mints no tombstone', async () => {
    const profileId = await insertSweptProfile(2);
    await seedDay(profileId, '2026-03-01', { side: 'yes' });
    const finalPick = await seedDay(profileId, '2026-03-02', { side: 'yes' });
    await seedDay(profileId, '2026-03-03'); // kills the 2-day run — not story-worthy

    const loaded = await loadReceiptOg(db, finalPick.pick!.id as string);
    expect(loaded!.data.variant).toBe('win');
    expect(loaded!.data.bustedRun).toBeNull();
  });

  it('voided-tail run: the final ANSWERED pick binds (endedOn is the void the profile never picked)', async () => {
    const profileId = await insertSweptProfile(3);
    await seedDay(profileId, '2026-03-01', { side: 'yes' });
    await seedDay(profileId, '2026-03-02', { side: 'yes' });
    const lastAnswered = await seedDay(profileId, '2026-03-03', { side: 'yes' });
    await seedDay(profileId, '2026-03-04', { voided: true }); // contiguous void joins the run
    await seedDay(profileId, '2026-03-05'); // uncovered miss — fatal

    const loaded = await loadReceiptOg(db, lastAnswered.pick!.id as string);
    expect(loaded!.data.variant).toBe('busted_streak');
    expect(loaded!.data.bustedRun).toEqual({
      length: 3,
      startedOn: '2026-03-01',
      endedOn: '2026-03-04', // §3.1: endedOn can be a date with no pick — binding still lands
    });
  });

  it('freeze-covered-tail run: the covered date joins the run; the last answered pick binds', async () => {
    const profileId = await insertSweptProfile(3);
    await seedDay(profileId, '2026-03-01', { side: 'yes' });
    await seedDay(profileId, '2026-03-02', { side: 'yes' });
    const lastAnswered = await seedDay(profileId, '2026-03-03', { side: 'yes' });
    await seedDay(profileId, '2026-03-04'); // missed but freeze-covered — joins the run
    await db.insert(streakFreezeUses).values({
      profileId,
      coveredDate: '2026-03-04',
      usedAt: new Date('2026-03-05T03:30:00Z'),
    });
    await seedDay(profileId, '2026-03-05'); // uncovered miss the day after the bridge — fatal

    const loaded = await loadReceiptOg(db, lastAnswered.pick!.id as string);
    expect(loaded!.data.variant).toBe('busted_streak');
    expect(loaded!.data.bustedRun).toEqual({
      length: 3,
      startedOn: '2026-03-01',
      endedOn: '2026-03-04', // the freeze-covered tail belongs to the run (§3.1)
    });
  });

  it('regrade-consistency: voiding the killer day resurrects the run — tombstone reverts, hash re-keys, stale v redirects', async () => {
    const profileId = await insertSweptProfile(3);
    await seedDay(profileId, '2026-03-01', { side: 'yes' });
    await seedDay(profileId, '2026-03-02', { side: 'yes' });
    const death = await seedDay(profileId, '2026-03-03', { side: 'yes' });
    const killer = await seedDay(profileId, '2026-03-04');

    const tombstone = await loadReceiptOg(db, death.pick!.id as string);
    expect(tombstone!.data.variant).toBe('busted_streak');

    // Post-reveal void of the gap day (§2 "regrade can resurrect the dead").
    await db.execute(sql`
      UPDATE questions SET status = 'voided', outcome = NULL, void_reason = 'post-reveal void'
      WHERE id = ${killer.question.id}
    `);

    const resurrected = await loadReceiptOg(db, death.pick!.id as string);
    expect(resurrected!.data.variant).toBe('win'); // back to a plain receipt
    expect(resurrected!.data.bustedRun).toBeNull();
    expect(resurrected!.hash).not.toBe(tombstone!.hash);

    // The cached tombstone URL can no longer be served as current — it 302s to the new render.
    const res = await ogReceiptGet(death.pick!.id as string, tombstone!.hash);
    expect(res.status).toBe(302);
    expect(new URL(res.headers.get('location')!).searchParams.get('v')).toBe(resurrected!.hash);
  });
});
