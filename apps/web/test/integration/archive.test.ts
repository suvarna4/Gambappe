/**
 * WS8-T5 integration: `app/q/page.tsx`'s query layer (`lib/archive.ts`) against real Postgres.
 * Covers the task's AC directly: "`/q` archive lists past questions" — including the negative
 * half (a non-revealed question must NOT appear), and the "Will X happen? The crowd said 63%"
 * description formatting (§10.1).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type pg from 'pg';
import { connect, markets, questions, type Db } from '@receipts/db';
import { buildMarket, buildQuestion, insertGradedQuestionScenario } from '@receipts/db/testing';
import { describeArchiveOutcome, loadArchiveListing } from '../../lib/archive';

const dbUrl =
  process.env.TEST_DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts_test';

let pool: pg.Pool;
let db: Db;

beforeAll(async () => {
  ({ pool, db } = connect({ connectionString: dbUrl }));
  await db.execute(sql`DROP SCHEMA public CASCADE`);
  await db.execute(sql`CREATE SCHEMA public`);
  await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  await migrate(db, {
    migrationsFolder: join(
      dirname(fileURLToPath(import.meta.url)),
      '..', '..', '..', '..', 'packages', 'db', 'drizzle',
    ),
  });
});

afterAll(async () => {
  await pool.end();
});

describe('loadArchiveListing', () => {
  it('includes a revealed question, excludes open/locked/voided ones', async () => {
    const { question: revealed } = await insertGradedQuestionScenario(db);

    const market = buildMarket();
    await db.insert(markets).values(market);
    const openQuestion = buildQuestion(market.id as string, { status: 'open' });
    const lockedQuestion = buildQuestion(market.id as string, { status: 'locked' });
    const voidedQuestion = buildQuestion(market.id as string, {
      status: 'voided',
      voidReason: 'test void',
    });
    await db.insert(questions).values([openQuestion, lockedQuestion, voidedQuestion]);

    const { entries } = await loadArchiveListing(db);
    const slugs = entries.map((e) => e.slug);

    expect(slugs).toContain(revealed.slug);
    expect(slugs).not.toContain(openQuestion.slug);
    expect(slugs).not.toContain(lockedQuestion.slug);
    expect(slugs).not.toContain(voidedQuestion.slug);
  });

  it('formats the "outcome. The crowd said N%" description from crowd-at-lock counts', async () => {
    const { question } = await insertGradedQuestionScenario(db);
    // buildGradedQuestionScenario: outcome='yes', crowdYesAtLock=2, crowdNoAtLock=1 -> 67%.

    const { entries } = await loadArchiveListing(db);
    const entry = entries.find((e) => e.slug === question.slug);

    expect(entry).toBeDefined();
    expect(entry!.headline).toBe(question.headline);
    expect(entry!.description).toBe(`${question.yesLabel}. The crowd said 67% ${question.yesLabel}.`);
    expect(entry!.revealedAt).toBe((question.revealedAt as Date).toISOString());
  });

  it('orders newest-revealed-first', async () => {
    const older = await insertGradedQuestionScenario(db);
    const newer = await insertGradedQuestionScenario(db);
    // Force a real ordering gap regardless of the factory's fixed default timestamps.
    await db
      .update(questions)
      .set({ revealedAt: new Date('2020-01-01T00:00:00Z') })
      .where(sql`${questions.id} = ${older.question.id}`);
    await db
      .update(questions)
      .set({ revealedAt: new Date('2030-01-01T00:00:00Z') })
      .where(sql`${questions.id} = ${newer.question.id}`);

    const { entries } = await loadArchiveListing(db);
    const olderIndex = entries.findIndex((e) => e.slug === older.question.slug);
    const newerIndex = entries.findIndex((e) => e.slug === newer.question.slug);

    expect(newerIndex).toBeGreaterThanOrEqual(0);
    expect(olderIndex).toBeGreaterThan(newerIndex);
  });
});

describe('describeArchiveOutcome', () => {
  it('falls back gracefully when crowd counts are both zero', () => {
    const description = describeArchiveOutcome({
      slug: 'x',
      headline: 'Will it happen?',
      yesLabel: 'Yes',
      noLabel: 'No',
      outcome: 'yes',
      crowdYesAtLock: 0,
      crowdNoAtLock: 0,
      revealedAt: null,
    });
    expect(description).toBe('Yes. The crowd said 0% Yes.');
  });

  it('falls back when outcome is null (defensive — should not occur for a revealed row)', () => {
    const description = describeArchiveOutcome({
      slug: 'x',
      headline: 'Will it happen?',
      yesLabel: 'Yes',
      noLabel: 'No',
      outcome: null,
      crowdYesAtLock: null,
      crowdNoAtLock: null,
      revealedAt: null,
    });
    expect(description).toBe('Will it happen? — the results are in.');
  });
});
