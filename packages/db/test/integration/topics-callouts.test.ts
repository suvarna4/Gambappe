/**
 * WS16-T2 integration (journeys plan §4/§5): topic-follow + call-out repositories and the
 * `kind='topic'` question regression.
 *
 * - `topic_follows`: set/clear/get, composite-PK idempotency.
 * - `listOpenTopicQuestions`: category filter, cap, soonest-close ordering, excludes
 *   locked/settled and non-topic kinds.
 * - `questions_daily_date_uq` does NOT constrain `kind='topic'` (two same-date topics are legal).
 * - `callouts`: create + lookup-by-hash; `acceptCallout` transactional accept minting the
 *   canonical-order next-week pairing, plus idempotency (second accept fails cleanly) and expiry.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { setTestClock } from '@receipts/core';
import type pg from 'pg';
import { connect, type Db } from '../../src/client.js';
import { insertMarket, insertQuestion } from '../../src/repositories/questions.js';
import {
  clearFollow,
  getFollows,
  listOpenTopicQuestions,
  setFollow,
} from '../../src/repositories/topics.js';
import {
  acceptCallout,
  createCallout,
  getCalloutByTokenHash,
} from '../../src/repositories/callouts.js';
import { nemesisPairings } from '../../src/schema/index.js';
import { profiles, seasons } from '../../src/schema/index.js';
import {
  buildCallout,
  buildMarket,
  buildProfile,
  buildQuestion,
  buildSeason,
} from '../../src/testing/factories.js';

const url =
  process.env.TEST_DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts_test';

let pool: pg.Pool;
let db: Db;

beforeAll(async () => {
  ({ pool, db } = connect({ connectionString: url }));
  await db.execute(sql`DROP SCHEMA public CASCADE`);
  await db.execute(sql`CREATE SCHEMA public`);
  await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  await migrate(db, {
    migrationsFolder: join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'drizzle'),
  });
});

afterAll(async () => {
  await pool.end();
});

afterEach(() => setTestClock(null));

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE topic_follows, callouts, nemesis_pairings, seasons, questions, markets, profiles RESTART IDENTITY CASCADE`,
  );
});

describe('topic_follows repository', () => {
  it('sets, reads, and clears follows; set is idempotent (composite PK)', async () => {
    const p = buildProfile();
    await db.insert(profiles).values(p);

    await setFollow(db, p.id as string, 'economics');
    await setFollow(db, p.id as string, 'economics'); // idempotent, no PK violation
    await setFollow(db, p.id as string, 'sports');
    expect((await getFollows(db, p.id as string)).sort()).toEqual(['economics', 'sports']);

    await clearFollow(db, p.id as string, 'economics');
    expect(await getFollows(db, p.id as string)).toEqual(['sports']);

    // clearing a non-follow is a no-op
    await clearFollow(db, p.id as string, 'culture');
    expect(await getFollows(db, p.id as string)).toEqual(['sports']);
  });
});

describe('listOpenTopicQuestions', () => {
  async function seedTopic(
    category: 'sports' | 'economics' | 'politics',
    closeOffsetHrs: number,
    status = 'open',
  ): Promise<string> {
    const market = buildMarket({
      category,
      closeTime: new Date(Date.now() + closeOffsetHrs * 3600_000),
    });
    await insertMarket(db, market);
    const q = buildQuestion(market.id as string, {
      kind: 'topic',
      questionDate: null,
      status: status as never,
    });
    await insertQuestion(db, q);
    return q.id as string;
  }

  it('returns open topics in the given categories, soonest-close first, capped', async () => {
    const late = await seedTopic('economics', 48);
    const soon = await seedTopic('sports', 2);
    const mid = await seedTopic('politics', 12);

    const all = await listOpenTopicQuestions(db, ['sports', 'economics', 'politics'], 8);
    expect(all.map((r) => r.question.id)).toEqual([soon, mid, late]);

    const capped = await listOpenTopicQuestions(db, ['sports', 'economics', 'politics'], 2);
    expect(capped.map((r) => r.question.id)).toEqual([soon, mid]);

    const filtered = await listOpenTopicQuestions(db, ['sports'], 8);
    expect(filtered.map((r) => r.question.id)).toEqual([soon]);

    expect(await listOpenTopicQuestions(db, [], 8)).toEqual([]);
  });

  it('excludes locked/settled topics and non-topic kinds', async () => {
    await seedTopic('sports', 4, 'locked');
    await seedTopic('sports', 4, 'revealed');
    // a daily in the same category must not appear
    const dm = buildMarket({ category: 'sports' });
    await insertMarket(db, dm);
    await insertQuestion(db, buildQuestion(dm.id as string, { status: 'open' }));

    expect(await listOpenTopicQuestions(db, ['sports'], 8)).toEqual([]);
  });
});

describe('questions_daily_date_uq excludes kind=topic (regression)', () => {
  it('allows two topic questions sharing a question_date', async () => {
    const m1 = buildMarket();
    const m2 = buildMarket();
    await insertMarket(db, m1);
    await insertMarket(db, m2);
    await insertQuestion(
      db,
      buildQuestion(m1.id as string, { kind: 'topic', questionDate: '2026-07-20', status: 'open' }),
    );
    // Same date, kind=topic — the partial unique index only covers kind='daily', so this is fine.
    await expect(
      insertQuestion(
        db,
        buildQuestion(m2.id as string, {
          kind: 'topic',
          questionDate: '2026-07-20',
          status: 'open',
        }),
      ),
    ).resolves.toBeDefined();
  });
});

describe('callouts repository', () => {
  async function seedTwoProfiles(): Promise<[string, string]> {
    const a = buildProfile();
    const b = buildProfile();
    await db.insert(profiles).values([a, b]);
    return [a.id as string, b.id as string];
  }

  async function seedSeason(): Promise<string> {
    const s = buildSeason({ startsOn: '2026-07-13', endsOn: '2026-12-31' });
    await db.insert(seasons).values(s);
    return s.id as string;
  }

  it('creates a pending callout and looks it up by token hash', async () => {
    const [challenger] = await seedTwoProfiles();
    const created = await createCallout(db, {
      challengerProfileId: challenger,
      tokenHash: 'hash-abc',
      expiresAt: new Date(Date.now() + 24 * 3600_000),
    });
    expect(created.status).toBe('pending');
    expect(created.opponentProfileId).toBeNull();

    const found = await getCalloutByTokenHash(db, 'hash-abc');
    expect(found?.id).toBe(created.id);
    expect(await getCalloutByTokenHash(db, 'nope')).toBeNull();
  });

  it('accepts transactionally: flips status + mints a canonical-order next-week pairing', async () => {
    const [challenger, opponent] = await seedTwoProfiles();
    const seasonId = await seedSeason();
    await createCallout(db, buildCalloutInput(challenger, 'hash-accept'));

    const res = await acceptCallout(db, {
      tokenHash: 'hash-accept',
      opponentProfileId: opponent,
      seasonId,
      weekStart: '2026-07-27',
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.callout.status).toBe('accepted');
    expect(res.callout.opponentProfileId).toBe(opponent);
    expect(res.callout.pairingId).toBe(res.pairing.id);
    // canonical a < b
    const [lo, hi] = [challenger, opponent].sort();
    expect(res.pairing.profileAId).toBe(lo);
    expect(res.pairing.profileBId).toBe(hi);
    expect(res.pairing.weekStart).toBe('2026-07-27');
    expect(res.pairing.status).toBe('scheduled');

    const rows = await db.select().from(nemesisPairings);
    expect(rows).toHaveLength(1);
  });

  it('is idempotent: a second accept fails cleanly without a second pairing', async () => {
    const [challenger, opponent] = await seedTwoProfiles();
    const seasonId = await seedSeason();
    await createCallout(db, buildCalloutInput(challenger, 'hash-idem'));

    const first = await acceptCallout(db, {
      tokenHash: 'hash-idem',
      opponentProfileId: opponent,
      seasonId,
      weekStart: '2026-07-27',
    });
    expect(first.ok).toBe(true);

    const second = await acceptCallout(db, {
      tokenHash: 'hash-idem',
      opponentProfileId: opponent,
      seasonId,
      weekStart: '2026-07-27',
    });
    expect(second).toEqual({ ok: false, reason: 'already_resolved' });
    expect(await db.select().from(nemesisPairings)).toHaveLength(1);
  });

  it('rejects an expired callout and lazily marks it expired', async () => {
    const [challenger, opponent] = await seedTwoProfiles();
    const seasonId = await seedSeason();
    const created = await createCallout(db, {
      challengerProfileId: challenger,
      tokenHash: 'hash-expired',
      expiresAt: new Date(Date.now() - 1000), // already past
    });

    const res = await acceptCallout(db, {
      tokenHash: 'hash-expired',
      opponentProfileId: opponent,
      seasonId,
      weekStart: '2026-07-27',
    });
    expect(res).toEqual({ ok: false, reason: 'expired' });

    const after = await getCalloutByTokenHash(db, 'hash-expired');
    expect(after?.status).toBe('expired');
    expect(created.status).toBe('pending'); // the row we created was pending
    expect(await db.select().from(nemesisPairings)).toHaveLength(0);
  });

  it('rejects self-challenge and unknown tokens', async () => {
    const [challenger] = await seedTwoProfiles();
    const seasonId = await seedSeason();
    await createCallout(db, buildCalloutInput(challenger, 'hash-self'));

    expect(
      await acceptCallout(db, {
        tokenHash: 'hash-self',
        opponentProfileId: challenger,
        seasonId,
        weekStart: '2026-07-27',
      }),
    ).toEqual({ ok: false, reason: 'self_challenge' });

    expect(
      await acceptCallout(db, {
        tokenHash: 'missing',
        opponentProfileId: challenger,
        seasonId,
        weekStart: '2026-07-27',
      }),
    ).toEqual({ ok: false, reason: 'not_found' });
  });

  function buildCalloutInput(challengerProfileId: string, tokenHash: string) {
    const row = buildCallout(challengerProfileId, { tokenHash });
    return {
      challengerProfileId,
      tokenHash: row.tokenHash as string,
      expiresAt: row.expiresAt as Date,
    };
  }
});
