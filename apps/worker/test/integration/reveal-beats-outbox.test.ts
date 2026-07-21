/**
 * WS9-T3 integration: `reveal:fire` writes reveal-triggered beats (§13.3) to the `notifications`
 * outbox against a real Postgres + pg-boss. Covers the task AC directly: each beat fires exactly
 * once per trigger (dedupe on re-fire), and no beat is ever written for a question still
 * `locked` (§6.5 publication rule).
 *
 * Streak fixtures use REAL sequential `settleQuestion` calls (not hand-seeded `profiles` streak
 * columns) so `current_streak`/`last_counted_date` reflect an actual replay over real history —
 * matching how `applyStreakForParticipant`'s full-history replay (`streak-replay.ts`) really
 * behaves, per `grading-streaks-reveal.test.ts`'s own convention for its multi-day scenarios.
 *
 * WS9-T4 addition: `reveal:fire` now ALSO writes a general `reveal` beat (email + push) for
 * EVERY graded participant on EVERY reveal (§13.2 "Reveal at 8"), on top of whichever of the
 * per-outcome beats above happen to fire — so every `revealDailyFor` call below now produces
 * `reveal` rows in addition to the per-outcome ones this file already asserted on before this
 * task; the `beatsWritten`/row-count expectations were updated accordingly (see inline comments
 * at each changed assertion). New: `never sends the general reveal beat before the question is
 * actually revealed (§19.3 WS9-T4 AC)` — extends the existing "never writes a beat for a
 * question still locked" test to check the `reveal` kind explicitly, and
 * `reveal-beats-outbox.test.ts`'s own re-fire assertions double as proof the AC holds under
 * redelivery too (a stale re-fire is a structural `noop`, never a second write).
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
import { settleQuestion } from '../../src/lib/settle-question.js';

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

/** Inserts + settles (for real, via `settleQuestion`) one daily with a single pick for
 * `participant`, plus a filler pick from a throwaway profile so crowd counts are sane. Returns
 * the reveal outcome so callers can assert on it when needed. */
async function revealDailyFor(opts: {
  questionDate: string;
  participant: ReturnType<typeof buildProfile>;
  won: boolean;
  entry: number;
  at: Date;
}) {
  const market = buildMarket({ status: 'resolved', outcome: 'yes' });
  await db.insert(markets).values(market);
  const filler = buildProfile();
  await db.insert(profiles).values(filler).onConflictDoNothing();
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
  await db.insert(picks).values([
    buildPick(question.id as string, opts.participant.id as string, {
      side: 'yes',
      yesPriceAtEntry: opts.entry,
      result: opts.won ? 'win' : 'loss',
      edge: computeEdge('yes', opts.entry, opts.won),
      gradedAt: new Date(`${opts.questionDate}T17:00:00Z`),
    }),
    buildPick(question.id as string, filler.id as string, {
      side: 'yes',
      yesPriceAtEntry: 0.5,
      result: 'win',
      edge: computeEdge('yes', 0.5, true),
      gradedAt: new Date(`${opts.questionDate}T17:00:00Z`),
    }),
  ]);
  return settleQuestion(db, pool, question.id as string, opts.at);
}

describe('reveal:fire beat wiring (WS9-T3, §13.3)', () => {
  it('writes a streak_milestone and a called_it beat to the outbox exactly once; a re-fire is a deduped no-op', async () => {
    const participant = buildProfile({ freezeBank: 0 });

    await revealDailyFor({ questionDate: '2026-08-01', participant, won: true, entry: 0.5, at: new Date('2026-08-01T20:00:01Z') });
    await revealDailyFor({ questionDate: '2026-08-02', participant, won: true, entry: 0.5, at: new Date('2026-08-02T20:00:01Z') });
    // 3rd consecutive win -> currentStreak lands on STREAK_MILESTONES[0]=3; also a longshot win
    // (implied prob 0.15 <= LONGSHOT_THRESHOLD) -> called_it too. D-J3 (WS19-T1): each settle now
    // also fires ONE per-settle push per participant, gated to the first settle of that profile's
    // ET day — day 3 is a fresh ET date so both the participant and that day's filler get one.
    // beatsWritten on day 3 = participant (streak_milestone + called_it + settle push) + filler
    // (settle push) = 4.
    const outcome = await revealDailyFor({ questionDate: '2026-08-03', participant, won: true, entry: 0.15, at: new Date('2026-08-03T20:00:01Z') });
    expect(outcome).toMatchObject({ status: 'revealed', calledItCount: 1, beatsWritten: 4, pushed: 2 });

    // The per-outcome beats (WS9-T3) are unchanged — email-only, date-scoped dedupe. Scope to the
    // email channel to isolate them from the per-settle push rows.
    const outcomeRows = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.profileId, participant.id as string), eq(notifications.channel, 'email')));
    expect(outcomeRows).toHaveLength(2);
    expect(outcomeRows.map((r) => r.kind).sort()).toEqual(['called_it', 'streak_milestone']);
    for (const row of outcomeRows) {
      expect(row.status).toBe('queued');
      expect(row.dedupeKey).toBe(`${row.kind}:2026-08-03:${participant.id}`);
    }
    const milestoneRow = outcomeRows.find((r) => r.kind === 'streak_milestone')!;
    expect(milestoneRow.payload).toEqual({ n: 3 });

    // D-J3: the per-settle push (`reveal_settle`, push channel) fired for the participant on ALL
    // THREE settle days (08-01, 08-02, 08-03) — each is a distinct ET date, so each is that
    // profile's first settle of the day. Date-scoped dedupe key, no `:channel` suffix (push only).
    const pushRows = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.profileId, participant.id as string), eq(notifications.channel, 'push')));
    expect(pushRows).toHaveLength(3);
    expect(pushRows.every((r) => r.kind === 'reveal_settle')).toBe(true);
    expect(pushRows.map((r) => r.dedupeKey).sort()).toEqual([
      `reveal_settle:2026-08-01:${participant.id}`,
      `reveal_settle:2026-08-02:${participant.id}`,
      `reveal_settle:2026-08-03:${participant.id}`,
    ]);
    const day3Push = pushRows.find((r) => r.dedupeKey === `reveal_settle:2026-08-03:${participant.id}`)!;
    expect(day3Push.payload).toMatchObject({ line: `⚡ ${(await db.select().from(questions).where(eq(questions.questionDate, '2026-08-03')))[0]!.headline} — it's done. Your receipt just graded itself.` });

    // Re-settle (stale redelivery re-examining an already-settled question) must not duplicate —
    // a stale re-run is a structural `noop`, so it can't write a second push or per-outcome beat.
    const questionRow = (await db.select().from(questions).where(eq(questions.questionDate, '2026-08-03')))[0]!;
    const second = await settleQuestion(db, pool, questionRow.id, new Date('2026-08-03T20:00:01Z'));
    expect(second.status).toBe('noop');
    const rowsAfterSecond = await db
      .select()
      .from(notifications)
      .where(eq(notifications.profileId, participant.id as string));
    expect(rowsAfterSecond).toHaveLength(5); // 2 outcome (email) + 3 settle pushes, unchanged
  });

  it('never writes a beat/push for a question that is still locked/ungraded (§6.5 publication rule)', async () => {
    const participant = buildProfile();
    await db.insert(profiles).values(participant);
    const market = buildMarket({ status: 'closed' });
    await db.insert(markets).values(market);
    const question = buildQuestion(market.id as string, {
      questionDate: '2026-08-20',
      status: 'locked',
      settledAt: null, // not graded -> settle is a no-op (D-J3: no re-arm), never reveals
      revealAt: new Date('2026-08-20T00:00:00Z'),
    });
    await db.insert(questions).values(question);

    const outcome = await settleQuestion(db, pool, question.id as string, new Date('2026-08-20T00:10:00Z'));
    expect(outcome.status).toBe('noop');

    const [row] = await db.select().from(questions).where(eq(questions.id, question.id));
    expect(row!.status).toBe('locked'); // explicitly still locked, not revealed

    const beatRows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.profileId, participant.id as string));
    expect(beatRows).toHaveLength(0);

    // AC: "settle push never sent before the question settles" — explicit, kind-scoped check.
    const pushRows = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.profileId, participant.id as string), eq(notifications.kind, 'reveal_settle')));
    expect(pushRows).toHaveLength(0);
  });

  it('fires streak_busted (not streak_milestone) when a >=3 streak resets, with the pre-reset length', async () => {
    const participant = buildProfile({ freezeBank: 0 });

    await revealDailyFor({ questionDate: '2026-08-05', participant, won: true, entry: 0.5, at: new Date('2026-08-05T20:00:01Z') });
    await revealDailyFor({ questionDate: '2026-08-06', participant, won: true, entry: 0.5, at: new Date('2026-08-06T20:00:01Z') });
    await revealDailyFor({ questionDate: '2026-08-07', participant, won: true, entry: 0.5, at: new Date('2026-08-07T20:00:01Z') });
    // 08-08: a real revealed daily participant does NOT pick (gap day, no freeze available).
    const gapMarket = buildMarket({ status: 'resolved', outcome: 'yes' });
    await db.insert(markets).values(gapMarket);
    const gapFiller = buildProfile();
    await db.insert(profiles).values(gapFiller);
    const gapQuestion = buildQuestion(gapMarket.id as string, {
      questionDate: '2026-08-08',
      status: 'locked',
      outcome: 'yes',
      settledAt: new Date('2026-08-08T17:00:00Z'),
      revealAt: new Date('2026-08-08T20:00:00Z'),
      crowdYesAtLock: 1,
      crowdNoAtLock: 0,
    });
    await db.insert(questions).values(gapQuestion);
    await db.insert(picks).values(
      buildPick(gapQuestion.id as string, gapFiller.id as string, {
        side: 'yes',
        yesPriceAtEntry: 0.5,
        result: 'win',
        edge: computeEdge('yes', 0.5, true),
        gradedAt: new Date('2026-08-08T17:00:00Z'),
      }),
    );
    await settleQuestion(db, pool, gapQuestion.id as string, new Date('2026-08-08T20:00:01Z'));

    // 08-09: participant answers again -> gap uncovered (no freeze) -> streak resets to 1.
    // D-J3: this settle fires the per-settle push for both the participant (streak_busted(1) email
    // + settle push) and that day's fresh filler (settle push) -> beatsWritten 3.
    const outcome = await revealDailyFor({ questionDate: '2026-08-09', participant, won: true, entry: 0.5, at: new Date('2026-08-09T20:00:01Z') });
    expect(outcome).toMatchObject({ status: 'revealed', beatsWritten: 3, pushed: 2 });

    const rows = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.profileId, participant.id as string), eq(notifications.kind, 'streak_busted')));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload).toEqual({ n: 3 }); // the streak that busted was 3 long (08-05..07)
  });
});
