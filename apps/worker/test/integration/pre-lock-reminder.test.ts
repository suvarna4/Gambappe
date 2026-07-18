/**
 * WS9-T4 integration: `notify:pre-lock-reminder` (§13.2 "pre-lock reminder for streak holders")
 * against a real Postgres. Covers the task AC directly: a streak holder who hasn't picked yet on
 * a question about to lock gets a `reveal_reminder` beat on both channels, exactly once even
 * across repeated ticks inside the lead window (dedupe_key idempotency under redelivery, §5.6/
 * §19.4 rule 4 — mirroring the idempotency conventions `streak:freeze-grant` and `reveal:fire`
 * already establish elsewhere in this suite).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type pg from 'pg';
import {
  connect,
  markets,
  notifications,
  picks,
  profiles,
  questions,
  type Db,
} from '@receipts/db';
import { buildMarket, buildPick, buildProfile, buildQuestion } from '@receipts/db/testing';
import { runPreLockReminder } from '../../src/jobs/pre-lock-reminder.js';

const dbUrl =
  process.env.TEST_DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts_test';

const AT = new Date('2026-07-19T15:30:00Z'); // "now" for every scenario below

let pool: pg.Pool;
let db: Db;

beforeAll(async () => {
  ({ pool, db } = connect({ connectionString: dbUrl }));
  await db.execute(sql`DROP SCHEMA public CASCADE`);
  await db.execute(sql`CREATE SCHEMA public`);
  await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  await migrate(db, {
    migrationsFolder: join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'packages', 'db', 'drizzle'),
  });
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await db.execute(sql`TRUNCATE notifications, picks, questions, markets, profiles RESTART IDENTITY CASCADE`);
});

async function insertOpenDaily(overrides: Parameters<typeof buildQuestion>[1] = {}) {
  const market = buildMarket({ status: 'open' });
  await db.insert(markets).values(market);
  const question = buildQuestion(market.id as string, {
    status: 'open',
    lockAt: new Date(AT.getTime() + 30 * 60_000), // 30 min out, inside the default 60-min lead
    ...overrides,
  });
  await db.insert(questions).values(question);
  return question;
}

describe('notify:pre-lock-reminder (WS9-T4, §13.2)', () => {
  it('reminds a streak holder who has not picked yet, on both channels, with the streak-length narration', async () => {
    const question = await insertOpenDaily();
    const holder = buildProfile({ currentStreak: 5 });
    await db.insert(profiles).values(holder);

    const report = await runPreLockReminder(db, AT);
    expect(report).toMatchObject({ questionsChecked: 1, candidatesFound: 1, written: 2, deduped: 0 });

    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.profileId, holder.id as string));
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.kind)).toEqual(['reveal_reminder', 'reveal_reminder']);
    expect(rows.map((r) => r.channel).sort()).toEqual(['email', 'push']);
    expect(rows.map((r) => r.dedupeKey).sort()).toEqual([
      `reveal_reminder:${question.questionDate}:${holder.id}:email`,
      `reveal_reminder:${question.questionDate}:${holder.id}:push`,
    ]);
    for (const row of rows) {
      expect(row.status).toBe('queued');
      expect((row.payload as { line: string }).line).toBe('Your 5-day streak is on the line. Pick before it locks.');
    }
  });

  it('does not remind a profile with no streak (current_streak = 0)', async () => {
    const question = await insertOpenDaily();
    void question;
    const noStreak = buildProfile({ currentStreak: 0 });
    await db.insert(profiles).values(noStreak);

    const report = await runPreLockReminder(db, AT);
    expect(report).toMatchObject({ questionsChecked: 1, candidatesFound: 0, written: 0 });

    const rows = await db.select().from(notifications);
    expect(rows).toHaveLength(0);
  });

  it('does not remind a streak holder who already picked today\'s question', async () => {
    const question = await insertOpenDaily();
    const holder = buildProfile({ currentStreak: 5 });
    await db.insert(profiles).values(holder);
    await db.insert(picks).values(
      buildPick(question.id as string, holder.id as string, { result: 'pending' }),
    );

    const report = await runPreLockReminder(db, AT);
    expect(report).toMatchObject({ questionsChecked: 1, candidatesFound: 0, written: 0 });

    const rows = await db.select().from(notifications);
    expect(rows).toHaveLength(0);
  });

  it('skips a question whose lock_at is outside the lead window', async () => {
    await insertOpenDaily({ lockAt: new Date(AT.getTime() + 3 * 3600_000) }); // 3h out, outside 60min lead
    const holder = buildProfile({ currentStreak: 5 });
    await db.insert(profiles).values(holder);

    const report = await runPreLockReminder(db, AT);
    expect(report).toMatchObject({ questionsChecked: 0, candidatesFound: 0, written: 0 });
  });

  it('skips a question whose lock_at has already passed (effective-state: no longer really "open")', async () => {
    await insertOpenDaily({ lockAt: new Date(AT.getTime() - 60_000) }); // 1 min in the past
    const holder = buildProfile({ currentStreak: 5 });
    await db.insert(profiles).values(holder);

    const report = await runPreLockReminder(db, AT);
    expect(report).toMatchObject({ questionsChecked: 0, candidatesFound: 0, written: 0 });
  });

  it('skips a question that is not status=open (already locked)', async () => {
    await insertOpenDaily({ status: 'locked' });
    const holder = buildProfile({ currentStreak: 5 });
    await db.insert(profiles).values(holder);

    const report = await runPreLockReminder(db, AT);
    expect(report).toMatchObject({ questionsChecked: 0, candidatesFound: 0, written: 0 });
  });

  it('skips a non-daily question — "streak holder" is a daily-participation concept (§6.6)', async () => {
    await insertOpenDaily({ kind: 'nemesis_bonus', questionDate: null });
    const holder = buildProfile({ currentStreak: 5 });
    await db.insert(profiles).values(holder);

    const report = await runPreLockReminder(db, AT);
    expect(report.candidatesFound).toBe(0);
    const rows = await db.select().from(notifications);
    expect(rows).toHaveLength(0);
  });

  it('idempotent under repeated ticks inside the lead window: dedupe_key makes a re-run a no-op (§19.4 rule 4)', async () => {
    await insertOpenDaily();
    const holder = buildProfile({ currentStreak: 5 });
    await db.insert(profiles).values(holder);

    const first = await runPreLockReminder(db, AT);
    expect(first.written).toBe(2);

    // A later 5-minute tick, still inside the window, still unpicked — same candidate re-evaluated.
    const second = await runPreLockReminder(db, new Date(AT.getTime() + 5 * 60_000));
    expect(second.written).toBe(0);
    expect(second.deduped).toBe(2);

    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.profileId, holder.id as string));
    expect(rows).toHaveLength(2); // still exactly one row per channel
  });

  it('handles multiple streak holders across a mix of picked/unpicked, using each profile\'s own streak length', async () => {
    const question = await insertOpenDaily();
    const [a, b, c] = [
      buildProfile({ currentStreak: 3 }),
      buildProfile({ currentStreak: 10 }),
      buildProfile({ currentStreak: 2 }),
    ];
    await db.insert(profiles).values([a, b, c]);
    // b already picked -> excluded.
    await db.insert(picks).values(buildPick(question.id as string, b.id as string, { result: 'pending' }));

    const report = await runPreLockReminder(db, AT);
    expect(report.candidatesFound).toBe(2); // a and c only

    const aRows = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.profileId, a.id as string), eq(notifications.channel, 'email')));
    expect((aRows[0]!.payload as { line: string }).line).toBe('Your 3-day streak is on the line. Pick before it locks.');

    const cRows = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.profileId, c.id as string), eq(notifications.channel, 'email')));
    expect((cRows[0]!.payload as { line: string }).line).toBe('Your 2-day streak is on the line. Pick before it locks.');

    const bRows = await db.select().from(notifications).where(eq(notifications.profileId, b.id as string));
    expect(bRows).toHaveLength(0);
  });
});
