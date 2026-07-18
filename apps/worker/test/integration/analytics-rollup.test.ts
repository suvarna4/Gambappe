/**
 * WS13-T2 golden test (§16.3 AC: "golden test from fixture events"): seeds one ET calendar
 * day's worth of analytics_events + minimal domain rows for every §16.3 metric, computes
 * `analytics:rollup` for that day, and asserts every resulting value by hand-computed
 * arithmetic. Requires a live Postgres (docker-compose / CI service).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { uuidv7 } from 'uuidv7';
import type pg from 'pg';
import {
  connect,
  duoQueueEntries,
  duos,
  markets,
  nemesisPairings,
  picks,
  profiles,
  questions,
  seasons,
  type Db,
} from '@receipts/db';
import { buildMarket, buildProfile, buildQuestion } from '@receipts/db/testing';
import { computeAnalyticsRollups } from '../../src/jobs/analytics-rollup.js';

const url =
  process.env.TEST_DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts_test';

const DATE = '2026-07-20'; // a Monday (ET) — matches nemesis_pairings.week_start below

let pool: pg.Pool;
let db: Db;

beforeAll(async () => {
  ({ pool, db } = connect({ connectionString: url }));
  await db.execute(sql`DROP SCHEMA public CASCADE`);
  await db.execute(sql`CREATE SCHEMA public`);
  await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  await migrate(db, {
    migrationsFolder: join(
      dirname(fileURLToPath(import.meta.url)),
      '..', '..', '..', '..', 'packages', 'db', 'drizzle',
    ),
  });

  const [pA, pB, pC, pF, pG, pH, pI, pD, pE] = [
    buildProfile({ kind: 'claimed' }), // spectator + picker
    buildProfile({ kind: 'claimed' }), // spectator only
    buildProfile({ kind: 'ghost' }), // full ghost->claim + k-factor chain
    buildProfile({ kind: 'ghost' }), // claim prompt shown, never completes
    buildProfile({ kind: 'ghost' }), // second trigger, completes
    buildProfile({ kind: 'claimed' }), // reveal attendee 1
    buildProfile({ kind: 'claimed' }), // reveal attendee 2
    buildProfile({ kind: 'claimed', botScore: 0.9 }), // flagged bot
    buildProfile({ kind: 'claimed', botScore: 0.1 }), // not flagged
  ];
  await db.insert(profiles).values([pA, pB, pC, pF, pG, pH, pI, pD, pE]);

  // Q1: today's daily question (activation/daily-answer-rate).
  const market1 = buildMarket();
  const q1 = buildQuestion(market1.id as string, { questionDate: DATE, kind: 'daily', status: 'open' });
  await db.insert(markets).values(market1);
  await db.insert(questions).values(q1);
  await db.insert(picks).values({
    id: uuidv7(),
    questionId: q1.id as string,
    profileId: pA.id as string,
    side: 'yes',
    yesPriceAtEntry: 0.5,
    priceStampedAt: new Date(`${DATE}T15:00:00Z`),
    pickedAt: new Date(`${DATE}T15:05:00Z`),
  });

  // Q2: a revealed bonus question (reveal-attendance-rate) — 4 picks, 2 attendees.
  const market2 = buildMarket();
  const revealAt = new Date(`${DATE}T20:00:00Z`);
  const q2 = buildQuestion(market2.id as string, {
    questionDate: null,
    kind: 'nemesis_bonus',
    status: 'revealed',
    revealAt,
    revealedAt: new Date(`${DATE}T20:05:00Z`),
  });
  await db.insert(markets).values(market2);
  await db.insert(questions).values(q2);
  await db.insert(picks).values(
    [pA, pB, pD, pE].map((p) => ({
      id: uuidv7(),
      questionId: q2.id as string,
      profileId: p.id as string,
      side: 'yes' as const,
      yesPriceAtEntry: 0.5,
      priceStampedAt: new Date(`${DATE}T09:00:00Z`),
      pickedAt: new Date(`${DATE}T09:05:00Z`),
    })),
  );

  const ev = (
    ts: string,
    event: string,
    profileId: string | null,
    props: Record<string, unknown> = {},
  ) => ({ ts: new Date(ts), event, profileId, props });

  await db.execute(sql`
    INSERT INTO analytics_events (ts, event, profile_id, props)
    VALUES
      (${new Date(`${DATE}T15:00:00Z`).toISOString()}::timestamptz, 'spectator_view', ${pA.id}::uuid, '{}'::jsonb),
      (${new Date(`${DATE}T15:05:00Z`).toISOString()}::timestamptz, 'pick_created', ${pA.id}::uuid, '{}'::jsonb),
      (${new Date(`${DATE}T15:00:00Z`).toISOString()}::timestamptz, 'spectator_view', ${pB.id}::uuid, '{}'::jsonb),
      (${new Date(`${DATE}T10:00:00Z`).toISOString()}::timestamptz, 'ghost_minted', ${pC.id}::uuid, '{}'::jsonb),
      (${new Date(`${DATE}T10:05:00Z`).toISOString()}::timestamptz, 'share_completed', ${pC.id}::uuid, '{}'::jsonb),
      (${new Date(`${DATE}T10:10:00Z`).toISOString()}::timestamptz, 'spectator_view', ${pC.id}::uuid, '{"source":"share_card"}'::jsonb),
      (${new Date(`${DATE}T10:15:00Z`).toISOString()}::timestamptz, 'claim_prompt_shown', ${pC.id}::uuid, '{"trigger":"streak_reminder"}'::jsonb),
      (${new Date(`${DATE}T10:20:00Z`).toISOString()}::timestamptz, 'claim_completed', ${pC.id}::uuid, '{}'::jsonb),
      (${new Date(`${DATE}T11:00:00Z`).toISOString()}::timestamptz, 'claim_prompt_shown', ${pF.id}::uuid, '{"trigger":"streak_reminder"}'::jsonb),
      (${new Date(`${DATE}T12:00:00Z`).toISOString()}::timestamptz, 'claim_prompt_shown', ${pG.id}::uuid, '{"trigger":"reveal_wall"}'::jsonb),
      (${new Date(`${DATE}T12:05:00Z`).toISOString()}::timestamptz, 'claim_completed', ${pG.id}::uuid, '{}'::jsonb),
      (${new Date(`${DATE}T20:10:00Z`).toISOString()}::timestamptz, 'reveal_attended', ${pH.id}::uuid, ${JSON.stringify({ question_id: q2.id })}::jsonb),
      (${new Date(`${DATE}T20:30:00Z`).toISOString()}::timestamptz, 'reveal_attended', ${pI.id}::uuid, ${JSON.stringify({ question_id: q2.id })}::jsonb),
      (${new Date(`${DATE}T16:00:00Z`).toISOString()}::timestamptz, 'chemistry_viewed', ${pA.id}::uuid, '{}'::jsonb),
      (${new Date(`${DATE}T16:05:00Z`).toISOString()}::timestamptz, 'chemistry_viewed', ${pB.id}::uuid, '{}'::jsonb),
      (${new Date(`${DATE}T16:10:00Z`).toISOString()}::timestamptz, 'duo_page_viewed', ${pC.id}::uuid, '{}'::jsonb),
      (${new Date(`${DATE}T17:00:00Z`).toISOString()}::timestamptz, 'block_created', ${pA.id}::uuid, '{}'::jsonb),
      (${new Date(`${DATE}T17:05:00Z`).toISOString()}::timestamptz, 'report_filed', ${pB.id}::uuid, '{}'::jsonb)
  `);
  void ev; // (kept for readability of the shape above; the raw insert covers every row)

  // Nemesis pairings for the week (DATE is itself the Monday): 1 completed, 1 not.
  const season = { id: uuidv7(), kind: 'nemesis' as const, startsOn: DATE, endsOn: '2026-12-31', name: 'Test season' };
  await db.insert(seasons).values(season);
  await db.insert(nemesisPairings).values([
    {
      id: uuidv7(), seasonId: season.id, weekStart: DATE,
      profileAId: pA.id as string, profileBId: pB.id as string, status: 'completed',
    },
    {
      id: uuidv7(), seasonId: season.id, weekStart: DATE,
      profileAId: pC.id as string, profileBId: pF.id as string, status: 'active',
    },
  ]);

  // Duo queue: 3 waiting, 1 matched (excluded from depth).
  const duo = { id: uuidv7(), profileAId: pA.id as string, profileBId: pB.id as string, status: 'active' as const };
  await db.insert(duos).values(duo);
  await db.insert(duoQueueEntries).values([
    { id: uuidv7(), profileId: pC.id as string, status: 'waiting' },
    { id: uuidv7(), profileId: pF.id as string, status: 'waiting' },
    { id: uuidv7(), profileId: pG.id as string, status: 'waiting' },
    { id: uuidv7(), profileId: pH.id as string, status: 'matched', matchedDuoId: duo.id },
  ]);

  // Rematch requests within the trailing 7d window: 1 accepted, 1 open.
  await db.execute(sql`
    INSERT INTO rematch_requests (id, requester_profile_id, target_profile_id, season_id, status, created_at)
    VALUES
      (${uuidv7()}::uuid, ${pA.id}::uuid, ${pB.id}::uuid, ${season.id}::uuid, 'accepted', ${new Date(`${DATE}T09:00:00Z`).toISOString()}::timestamptz),
      (${uuidv7()}::uuid, ${pC.id}::uuid, ${pF.id}::uuid, ${season.id}::uuid, 'open', ${new Date(`${DATE}T09:05:00Z`).toISOString()}::timestamptz)
  `);
});

afterAll(async () => {
  await pool.end();
});

describe('analytics:rollup golden test (§16.3)', () => {
  it('computes every metric correctly from the fixture', async () => {
    const rows = await computeAnalyticsRollups(db, DATE);
    const byMetric = (metric: string) => rows.filter((r) => r.metric === metric);
    const one = (metric: string) => {
      const matches = byMetric(metric);
      expect(matches, metric).toHaveLength(1);
      return matches[0]!;
    };

    // DAU: distinct actors with any event = {pA,pB,pC,pF,pG,pH,pI} = 7.
    expect(one('dau').value).toBe(7);
    expect(one('wau').value).toBe(7); // same single day of data in the trailing window

    // activation: viewers {pA,pB,pC}=3, pickers {pA}=1 -> 1/3.
    expect(one('activation_rate').value).toBeCloseTo(1 / 3, 6);

    const conversions = byMetric('ghost_claim_conversion');
    expect(conversions).toHaveLength(2);
    const streakReminder = conversions.find((r) => r.dims?.['trigger'] === 'streak_reminder');
    const revealWall = conversions.find((r) => r.dims?.['trigger'] === 'reveal_wall');
    expect(streakReminder?.value).toBeCloseTo(0.5, 6); // shown {pC,pF}=2, completed {pC}=1
    expect(revealWall?.value).toBeCloseTo(1.0, 6); // shown {pG}=1, completed {pG}=1

    expect(one('daily_answer_rate').value).toBeCloseTo(0.25, 6); // active claimed {pA,pB,pH,pI}=4, answered {pA}=1
    expect(one('reveal_attendance_rate').value).toBeCloseTo(0.5, 6); // 4 picks on Q2, 2 attendees

    expect(one('cards_per_user_week').value).toBe(0); // no share_card_generated events fixtured

    const kFactor = byMetric('k_factor_chain');
    expect(kFactor).toHaveLength(4);
    const stage = (name: string) => kFactor.find((r) => r.dims?.['stage'] === name)?.value;
    expect(stage('share_completed')).toBe(1);
    expect(stage('spectator_view_share')).toBe(1);
    expect(stage('ghost_minted')).toBe(1);
    expect(stage('claim_completed')).toBe(2); // pC, pG

    expect(one('nemesis_completion_rate').value).toBeCloseTo(0.5, 6); // 1 completed of 2
    expect(one('duo_queue_depth').value).toBe(3); // matched entry excluded
    expect(one('duo_rematch_rate').value).toBeCloseTo(0.5, 6); // 1 accepted of 2

    expect(one('chemistry_stat_views').value).toBe(3); // 2 chemistry_viewed + 1 duo_page_viewed

    expect(one('block_rate').value).toBeCloseTo(1 / 7, 6); // 1 block_created / DAU(7)
    expect(one('report_rate').value).toBeCloseTo(1 / 7, 6); // 1 report_filed / DAU(7)

    expect(one('bot_flag_rate').value).toBeCloseTo(1 / 9, 6); // 1 flagged of 9 profiles
  });

  it('is idempotent: rerunning for the same date replaces rather than duplicates rows', async () => {
    const { replaceMetricRollupsForDate, listMetricRollups } = await import('@receipts/db');
    const rows = await computeAnalyticsRollups(db, DATE);

    await replaceMetricRollupsForDate(db, DATE, rows);
    const firstRun = await listMetricRollups(db, DATE);

    await replaceMetricRollupsForDate(db, DATE, rows);
    const secondRun = await listMetricRollups(db, DATE);

    expect(secondRun).toHaveLength(firstRun.length);
    expect(secondRun.length).toBe(rows.length);
  });
});
