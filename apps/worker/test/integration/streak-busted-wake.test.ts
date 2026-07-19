/**
 * SW9-T1 AC (h) (obituary-handoff §3.3(4)): the `streak_busted` beat fires at the WAKE — the
 * viewer's first counted daily after a break — even when `streak:sweep` already applied the
 * break the night before. That is the ordering the pre-SW9 live-field key (`previousStreak >= 3
 * && currentStreak === 1`) silently missed: by reveal time the sweep had zeroed
 * `profiles.current_streak`, so `previousStreak` was 0 and no beat ever fired in the normal
 * flow. Per the doc's §1 binding rule, this drives the REAL jobs — `runRevealFire` builds the
 * run, the REAL `runStreakSweep` applies the break, and the wake reveal is a real
 * `runRevealFire` — against really-seeded Postgres history. No payload or state mocks anywhere.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import PgBoss from 'pg-boss';
import type pg from 'pg';
import { connect, markets, notifications, picks, profiles, questions, type Db } from '@receipts/db';
import { buildMarket, buildPick, buildProfile, buildQuestion, computeEdge } from '@receipts/db/testing';
import { runRevealFire } from '../../src/jobs/reveal-fire.js';
import { runStreakSweep } from '../../src/jobs/streak-sweep.js';

const dbUrl =
  process.env.TEST_DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts_test';

let pool: pg.Pool;
let db: Db;
let boss: PgBoss;

beforeAll(async () => {
  ({ pool, db } = connect({ connectionString: dbUrl }));
  await db.execute(sql`DROP SCHEMA public CASCADE`);
  await db.execute(sql`CREATE SCHEMA public`);
  await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  await db.execute(sql`DROP SCHEMA IF EXISTS pgboss CASCADE`);
  await migrate(db, {
    migrationsFolder: join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'packages', 'db', 'drizzle'),
  });

  boss = new PgBoss({ connectionString: dbUrl, schema: 'pgboss' });
  await boss.start();
  await boss.createQueue('reveal:fire');
});

afterAll(async () => {
  await boss.stop({ graceful: false });
  await pool.end();
});

/** Inserts + reveals (for real, via `runRevealFire`) one daily. `participant` picks only when
 * `participates` — a filler profile always picks so the day is a real revealed daily either way. */
async function revealDaily(opts: {
  questionDate: string;
  participant: ReturnType<typeof buildProfile>;
  participates: boolean;
  at: Date;
}) {
  const market = buildMarket({ status: 'resolved', outcome: 'yes' });
  await db.insert(markets).values(market);
  const filler = buildProfile();
  await db.insert(profiles).values(filler);
  const question = buildQuestion(market.id as string, {
    questionDate: opts.questionDate,
    status: 'locked',
    outcome: 'yes',
    settledAt: new Date(`${opts.questionDate}T17:00:00Z`),
    revealAt: opts.at,
    crowdYesAtLock: 2,
    crowdNoAtLock: 0,
  });
  await db.insert(questions).values(question);
  await db.insert(profiles).values(opts.participant).onConflictDoNothing();
  const dayPicks = [
    buildPick(question.id as string, filler.id as string, {
      side: 'yes',
      yesPriceAtEntry: 0.5,
      result: 'win',
      edge: computeEdge('yes', 0.5, true),
      gradedAt: new Date(`${opts.questionDate}T17:00:00Z`),
    }),
  ];
  if (opts.participates) {
    dayPicks.push(
      buildPick(question.id as string, opts.participant.id as string, {
        side: 'yes',
        yesPriceAtEntry: 0.5,
        result: 'win',
        edge: computeEdge('yes', 0.5, true),
        gradedAt: new Date(`${opts.questionDate}T17:00:00Z`),
      }),
    );
  }
  await db.insert(picks).values(dayPicks);
  return runRevealFire(db, pool, boss, question.id as string, opts.at);
}

async function bustedRowsFor(profileId: string) {
  return db
    .select()
    .from(notifications)
    .where(and(eq(notifications.profileId, profileId), eq(notifications.kind, 'streak_busted')));
}

describe('streak_busted at the wake (SW9-T1 AC (h), obituary-handoff §3.3(4))', () => {
  it('fires with n = dead run length even when streak:sweep applied the break the night before, and only once', async () => {
    const participant = buildProfile({ freezeBank: 0 });

    // 3-day run, built by REAL reveals (2026-09-01..03).
    await revealDaily({ questionDate: '2026-09-01', participant, participates: true, at: new Date('2026-09-01T20:00:01Z') });
    await revealDaily({ questionDate: '2026-09-02', participant, participates: true, at: new Date('2026-09-02T20:00:01Z') });
    await revealDaily({ questionDate: '2026-09-03', participant, participates: true, at: new Date('2026-09-03T20:00:01Z') });

    // 2026-09-04: a real revealed daily the participant misses...
    await revealDaily({ questionDate: '2026-09-04', participant, participates: false, at: new Date('2026-09-04T20:00:01Z') });
    // ...and the REAL streak:sweep (03:30 ET next day) applies the break — the normal flow.
    const sweep = await runStreakSweep(db, pool, new Date('2026-09-05T07:30:00Z'));
    expect(sweep).toMatchObject({ targetDate: '2026-09-04' });
    expect(sweep.swept).toBeGreaterThanOrEqual(1);

    // The sweep has already zeroed the live field — this is exactly the state in which the old
    // live-field beat key (`previousStreak >= 3 && currentStreak === 1`) could never fire,
    // because the reveal's `previousStreak` reads 0 from here on.
    const [sweptRow] = await db.select().from(profiles).where(eq(profiles.id, participant.id as string));
    expect(sweptRow!.currentStreak).toBe(0);
    expect(await bustedRowsFor(participant.id as string)).toHaveLength(0); // sweep itself writes no beat

    // 2026-09-05: first day back — the wake. The re-keyed beat fires off the replay signal.
    await revealDaily({ questionDate: '2026-09-05', participant, participates: true, at: new Date('2026-09-05T20:00:01Z') });
    const rows = await bustedRowsFor(participant.id as string);
    expect(rows).toHaveLength(1);
    // §3.3(4) narration-length rule: n is the DEAD run's length (3), matching the obituary card.
    expect(rows[0]!.payload).toEqual({ n: 3 });
    // Death-scoped dedupe (PR #79 review finding 1): keyed on the dead run's endedOn (09-03,
    // its last counted day), not the wake question's date — one death, one key, forever.
    expect(rows[0]!.dedupeKey).toBe(`streak_busted:2026-09-03:${participant.id}`);

    // Second day back: the live run now started YESTERDAY — no second funeral.
    await revealDaily({ questionDate: '2026-09-06', participant, participates: true, at: new Date('2026-09-06T20:00:01Z') });
    expect(await bustedRowsFor(participant.id as string)).toHaveLength(1);
  });

  it('does NOT fire for a dead run below the >=3 threshold (§13.3 threshold applies to the beat, not the contract block)', async () => {
    const participant = buildProfile({ freezeBank: 0 });

    // 2-day run, swept break, return — broken_run WOULD be emitted by the payload (no server
    // threshold there), but the beat honors §13.3's >= 3.
    await revealDaily({ questionDate: '2026-09-10', participant, participates: true, at: new Date('2026-09-10T20:00:01Z') });
    await revealDaily({ questionDate: '2026-09-11', participant, participates: true, at: new Date('2026-09-11T20:00:01Z') });
    await revealDaily({ questionDate: '2026-09-12', participant, participates: false, at: new Date('2026-09-12T20:00:01Z') });
    await runStreakSweep(db, pool, new Date('2026-09-13T07:30:00Z'));
    await revealDaily({ questionDate: '2026-09-13', participant, participates: true, at: new Date('2026-09-13T20:00:01Z') });

    expect(await bustedRowsFor(participant.id as string)).toHaveLength(0);
  });
});
