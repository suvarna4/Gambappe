/**
 * XH-T5 integration AC (docs/xtrace-hackathon-tasks.md): `companion:ingest` against a real
 * Postgres, with a fake `XtraceClient` capturing calls (no real network).
 *
 *  - Both sides of a concluded pairing + pairing-thread posts ingest; a rerun makes no new calls
 *    (idempotency, via companion_ingest_log).
 *  - PII scrub: a seeded email/phone survive as `[redacted]`, never verbatim, in the captured
 *    payload.
 *  - A failing ingest leaves the source unmarked so the next run retries it.
 *  - Shared budget: verdicts fill MAX_SOURCES_PER_RUN (200) before posts get any of it.
 *  - Circuit breaker: aborts after exactly 5 consecutive `ingest()` failures; an intervening
 *    success resets the counter.
 *  - Deadline: the wall-clock abort fires BETWEEN the two per-side calls of one pairing, not
 *    only between pairings.
 *  - xTrace group id resolution (XH-T11): a pairing's group is created via `createGroup` at
 *    most once per run even when both its verdict AND its posts are candidates; a pairing with
 *    an existing `companion_xtrace_groups` row never calls `createGroup` again; a `createGroup`
 *    failure skips the source (not marked ingested) and counts toward the circuit breaker.
 *
 * Connects via TEST_DATABASE_URL, same convention as `nemesis-conclude.test.ts`.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type pg from 'pg';
import { setTestClock } from '@receipts/core';
import {
  companionIngestLog,
  companionXtraceGroups,
  connect,
  insertXtraceGroupIdIdempotent,
  nemesisPairings,
  posts,
  profiles,
  seasons,
  type Db,
  type ProfileRow,
} from '@receipts/db';
import { buildNemesisPairing, buildProfile, buildSeason } from '@receipts/db/testing';
import { pairingConvId, type IngestArgs, type XtraceClient } from '@receipts/companion';
import { uuidv7 } from 'uuidv7';
import { runCompanionIngest } from '../../src/jobs/companion-ingest.js';
import type { JobContext } from '../../src/context.js';

const dbUrl =
  process.env.TEST_DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts_test';

const AT = new Date('2026-07-24T08:00:00Z'); // Fri 04:00 ET (EDT, UTC-4) — companion:ingest's cron

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
      '..',
      '..',
      '..',
      '..',
      'packages',
      'db',
      'drizzle',
    ),
  });
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE companion_artifacts, companion_ingest_log, companion_xtrace_groups, posts, nemesis_pairings, seasons, profiles RESTART IDENTITY CASCADE`,
  );
});

afterEach(() => {
  setTestClock(null);
});

function makeCtx(): JobContext {
  return {
    db,
    pool: undefined as unknown as JobContext['pool'],
    boss: undefined as unknown as JobContext['boss'],
    redis: undefined as unknown as JobContext['redis'],
  };
}

/** `groupCallsOut`, if provided, records each `createGroup` call's `name` argument (XH-T11) —
 * lets a test assert HOW MANY TIMES a group was created, not just what `ingest` was tagged with. */
function makeCapturingXtrace(
  behavior: (args: IngestArgs) => boolean = () => true,
  groupCallsOut?: string[],
): {
  client: XtraceClient;
  calls: IngestArgs[];
} {
  const calls: IngestArgs[] = [];
  return {
    calls,
    client: {
      async ingest(args) {
        calls.push(args);
        return behavior(args);
      },
      async search() {
        return [];
      },
      async createGroup(args) {
        groupCallsOut?.push(args.name);
        return 'grp_test';
      },
    },
  };
}

function makeScriptedXtrace(results: boolean[]): { client: XtraceClient; calls: IngestArgs[] } {
  const calls: IngestArgs[] = [];
  let i = 0;
  return {
    calls,
    client: {
      async ingest(args) {
        calls.push(args);
        const result = i < results.length ? results[i]! : true;
        i += 1;
        return result;
      },
      async search() {
        return [];
      },
      async createGroup() {
        return 'grp_test';
      },
    },
  };
}

async function seedProfile(): Promise<ProfileRow> {
  const p = buildProfile({ kind: 'claimed', status: 'active' });
  const [row] = await db.insert(profiles).values(p).returning();
  return row!;
}

async function seedSeason(): Promise<string> {
  const s = buildSeason();
  await db.insert(seasons).values(s);
  return s.id as string;
}

interface SeededPairing {
  id: string;
  profileAId: string;
  profileBId: string;
}

/** A `completed` pairing with a verdict shaped exactly like `nemesis:conclude` writes it —
 * `narration` keyed by profile id, one line per side. */
async function seedConcludedPairing(seasonId: string, weekStart: string): Promise<SeededPairing> {
  const a = await seedProfile();
  const b = await seedProfile();
  const pairing = buildNemesisPairing(seasonId, a.id as string, b.id as string, {
    weekStart,
    status: 'completed',
    winnerProfileId: a.id as string,
    verdict: {
      scoreA: 2,
      scoreB: 1,
      winner: 'a',
      narration: {
        [a.id as string]: { line: `${a.handle} took it.`, emphasis: null },
        [b.id as string]: { line: `${b.handle} came up short.`, emphasis: null },
      },
    },
  });
  await db.insert(nemesisPairings).values(pairing);
  return { id: pairing.id as string, profileAId: a.id as string, profileBId: b.id as string };
}

/** `count` concluded pairings sharing one season/week — bulk-inserted (2 statements total) so
 * the shared-budget test (150 pairings) stays fast. */
async function seedManyConcludedPairings(
  seasonId: string,
  weekStart: string,
  count: number,
): Promise<string[]> {
  const profileRows = Array.from({ length: count * 2 }, () =>
    buildProfile({ kind: 'claimed', status: 'active' }),
  );
  await db.insert(profiles).values(profileRows);

  const pairingRows = [];
  const pairingIds: string[] = [];
  for (let i = 0; i < count; i++) {
    const a = profileRows[i * 2]!;
    const b = profileRows[i * 2 + 1]!;
    const pairing = buildNemesisPairing(seasonId, a.id as string, b.id as string, {
      weekStart,
      status: 'completed',
      winnerProfileId: a.id as string,
      verdict: {
        scoreA: 2,
        scoreB: 1,
        winner: 'a',
        narration: {
          [a.id as string]: { line: 'won', emphasis: null },
          [b.id as string]: { line: 'lost', emphasis: null },
        },
      },
    });
    pairingRows.push(pairing);
    pairingIds.push(pairing.id as string);
  }
  await db.insert(nemesisPairings).values(pairingRows);
  return pairingIds;
}

/** An `active` (unconcluded — `verdict` null) pairing purely to host thread posts, kept
 * separate from the verdict-candidate pairings above. */
async function seedActivePairingHost(seasonId: string, weekStart: string): Promise<SeededPairing> {
  const a = await seedProfile();
  const b = await seedProfile();
  const pairing = buildNemesisPairing(seasonId, a.id as string, b.id as string, {
    weekStart,
    status: 'active',
    winnerProfileId: null,
    verdict: null,
  });
  await db.insert(nemesisPairings).values(pairing);
  return { id: pairing.id as string, profileAId: a.id as string, profileBId: b.id as string };
}

async function seedPost(
  pairingId: string,
  authorId: string,
  body: string,
  at: Date,
): Promise<string> {
  const id = uuidv7();
  await db.insert(posts).values({
    id,
    contextKind: 'pairing',
    contextId: pairingId,
    profileId: authorId,
    body,
    status: 'visible',
    createdAt: at,
    updatedAt: at,
  });
  return id;
}

/** `count` visible posts in one thread, staggered 1s apart so `ORDER BY created_at` is
 * unambiguous — bulk-inserted so the budget/circuit-breaker tests stay fast. */
async function seedManyPosts(
  pairingId: string,
  authorId: string,
  count: number,
  baseAt: Date,
): Promise<void> {
  const rows = Array.from({ length: count }, (_, i) => ({
    id: uuidv7(),
    contextKind: 'pairing' as const,
    contextId: pairingId,
    profileId: authorId,
    body: `post number ${i}`,
    status: 'visible' as const,
    createdAt: new Date(baseAt.getTime() + i * 1000),
    updatedAt: new Date(baseAt.getTime() + i * 1000),
  }));
  await db.insert(posts).values(rows);
}

describe('runCompanionIngest — primary ingestion + idempotency', () => {
  it('ingests both sides of a concluded pairing and both thread posts; a rerun makes no new calls', async () => {
    const seasonId = await seedSeason();
    const pairing = await seedConcludedPairing(seasonId, '2026-01-05');
    await seedPost(pairing.id, pairing.profileAId, 'gg, good week', AT);
    await seedPost(pairing.id, pairing.profileBId, 'rematch soon', new Date(AT.getTime() + 1000));

    const { client, calls } = makeCapturingXtrace();
    const report = await runCompanionIngest(makeCtx(), client, AT);

    expect(report).toEqual({
      pairingsIngested: 1,
      pairingsSkipped: 0,
      postsIngested: 2,
      postsSkipped: 0,
      aborted: false,
    });
    expect(calls).toHaveLength(4);

    // groupIds is the fake's createGroup() return value ('grp_test'), NOT a
    // pairingId-derived string — that's the whole XH-T11 fix (see the
    // "xTrace group id resolution" describe block below for dedicated coverage).
    expect(calls[0]).toMatchObject({
      userId: pairing.profileAId,
      convId: pairingConvId(pairing.id, pairing.profileAId),
      groupIds: ['grp_test'],
    });
    expect(calls[1]).toMatchObject({
      userId: pairing.profileBId,
      convId: pairingConvId(pairing.id, pairing.profileBId),
      groupIds: ['grp_test'],
    });
    expect(calls[2]).toMatchObject({
      userId: pairing.profileAId,
      convId: pairingConvId(pairing.id, pairing.profileAId),
      groupIds: ['grp_test'],
    });
    expect(calls[2]?.messages[0]?.content).toContain('gg, good week');
    expect(calls[3]).toMatchObject({ userId: pairing.profileBId });
    expect(calls[3]?.messages[0]?.content).toContain('rematch soon');

    const logRows = await db.select().from(companionIngestLog);
    expect(logRows).toHaveLength(3); // 1 pairing_verdict + 2 post

    const rerun = await runCompanionIngest(makeCtx(), client, AT);
    expect(rerun).toEqual({
      pairingsIngested: 0,
      pairingsSkipped: 0,
      postsIngested: 0,
      postsSkipped: 0,
      aborted: false,
    });
    expect(calls).toHaveLength(4); // unchanged
  });
});

describe('PII scrub', () => {
  it('redacts an email and phone number in an ingested post, surrounding text intact', async () => {
    const seasonId = await seedSeason();
    const pairing = await seedConcludedPairing(seasonId, '2026-01-05');
    const body = 'reach me at fox@example.com or (555) 123-4567 for the rematch';
    await seedPost(pairing.id, pairing.profileAId, body, AT);

    const { client, calls } = makeCapturingXtrace();
    await runCompanionIngest(makeCtx(), client, AT);

    const postCall = calls.find((c) => c.messages[0]?.content.includes('rivalry thread'));
    const content = postCall?.messages[0]?.content ?? '';
    expect(content).not.toContain('fox@example.com');
    expect(content).not.toContain('555');
    expect(content).toContain('[redacted]');
    expect(content).toContain('for the rematch');
  });
});

describe('fail-open: a false return leaves the source unmarked', () => {
  it('does not mark ingested on failure; the next run retries', async () => {
    const seasonId = await seedSeason();
    await seedConcludedPairing(seasonId, '2026-01-05');

    const { client: failing } = makeCapturingXtrace(() => false);
    const first = await runCompanionIngest(makeCtx(), failing, AT);
    expect(first.pairingsIngested).toBe(0);
    expect(first.pairingsSkipped).toBe(1);
    expect(await db.select().from(companionIngestLog)).toHaveLength(0);

    const { client: succeeding, calls } = makeCapturingXtrace(() => true);
    const second = await runCompanionIngest(makeCtx(), succeeding, AT);
    expect(second.pairingsIngested).toBe(1);
    expect(calls).toHaveLength(2); // both sides retried
  });
});

describe('shared budget (MAX_SOURCES_PER_RUN = 200)', () => {
  it('fills the budget with verdicts first, then posts with whatever remains', async () => {
    const seasonId = await seedSeason();
    await seedManyConcludedPairings(seasonId, '2026-01-05', 150);
    const host = await seedActivePairingHost(seasonId, '2026-02-02');
    await seedManyPosts(host.id, host.profileAId, 150, AT);

    const { client } = makeCapturingXtrace();
    const report = await runCompanionIngest(makeCtx(), client, AT);

    expect(report.aborted).toBe(false);
    expect(report.pairingsIngested).toBe(150);
    expect(report.pairingsSkipped).toBe(0);
    expect(report.postsIngested).toBe(50); // 200 - 150
    expect(report.postsSkipped).toBe(0);
    expect(report.pairingsIngested + report.postsIngested).toBe(200);
  }, 30_000);
});

describe('circuit breaker', () => {
  it('aborts after exactly 5 consecutive ingest() failures', async () => {
    const seasonId = await seedSeason();
    const host = await seedActivePairingHost(seasonId, '2026-02-02');
    await seedManyPosts(host.id, host.profileAId, 10, AT);

    const { client, calls } = makeScriptedXtrace(Array(10).fill(false));
    const report = await runCompanionIngest(makeCtx(), client, AT);

    expect(calls).toHaveLength(5);
    expect(report.aborted).toBe(true);
    expect(report.postsIngested).toBe(0);
    expect(report.postsSkipped).toBe(5);
  });

  it('an intervening success resets the consecutive-failure counter — no abort', async () => {
    const seasonId = await seedSeason();
    const host = await seedActivePairingHost(seasonId, '2026-02-02');
    await seedManyPosts(host.id, host.profileAId, 9, AT);

    const { client, calls } = makeScriptedXtrace([
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
    ]);
    const report = await runCompanionIngest(makeCtx(), client, AT);

    expect(calls).toHaveLength(9); // never aborted — all 9 attempted
    expect(report.aborted).toBe(false);
    expect(report.postsIngested).toBe(1);
    expect(report.postsSkipped).toBe(8);
  });
});

describe('deadline abort', () => {
  it('aborts once the run exceeds the 5-minute deadline, checked BETWEEN the two per-side calls', async () => {
    setTestClock(AT);
    const seasonId = await seedSeason();
    await seedConcludedPairing(seasonId, '2026-01-05');
    await seedConcludedPairing(seasonId, '2026-01-12'); // a second pairing that must never be touched

    let count = 0;
    const client: XtraceClient = {
      async ingest() {
        count += 1;
        if (count === 1) setTestClock(new Date(AT.getTime() + 6 * 60_000)); // +6 min, past the 5-min deadline
        return true;
      },
      async search() {
        return [];
      },
      async createGroup() {
        return 'grp_test';
      },
    };

    const report = await runCompanionIngest(makeCtx(), client, AT);

    // Only pairingA's side-A call ever happened — side B (same pairing) and pairingB were
    // never attempted, proving the deadline check runs between individual calls.
    expect(count).toBe(1);
    expect(report.aborted).toBe(true);
    expect(report.pairingsIngested).toBe(0);
    expect(report.pairingsSkipped).toBe(1);
    expect(await db.select().from(companionIngestLog)).toHaveLength(0);
  });
});

describe('xTrace group id resolution (XH-T11)', () => {
  it("resolves a pairing's group via createGroup exactly ONCE even when its verdict AND its posts are both candidates in the same run", async () => {
    const seasonId = await seedSeason();
    const pairing = await seedConcludedPairing(seasonId, '2026-01-05');
    // Posts on the SAME (now completed) pairing — listCandidatePairingPostsForIngest includes
    // 'completed' pairings, so this pairing is hit by BOTH loops in one runCompanionIngest call.
    await seedPost(pairing.id, pairing.profileAId, 'gg, good week', AT);
    await seedPost(pairing.id, pairing.profileBId, 'rematch soon', new Date(AT.getTime() + 1000));

    const groupCalls: string[] = [];
    const { client, calls } = makeCapturingXtrace(() => true, groupCalls);
    const report = await runCompanionIngest(makeCtx(), client, AT);

    expect(report).toMatchObject({ pairingsIngested: 1, postsIngested: 2 });
    expect(calls).toHaveLength(4); // 2 verdict sides + 2 posts, all tagged with the same group
    expect(calls.every((c) => c.groupIds?.[0] === 'grp_test')).toBe(true);
    expect(groupCalls).toEqual([`pairing:${pairing.id}`]); // createGroup called exactly once

    const stored = await db
      .select()
      .from(companionXtraceGroups)
      .where(eq(companionXtraceGroups.pairingId, pairing.id));
    expect(stored).toHaveLength(1);
    expect(stored[0]?.xtraceGroupId).toBe('grp_test');
  });

  it('never calls createGroup for a pairing that already has a persisted group id', async () => {
    const seasonId = await seedSeason();
    const pairing = await seedConcludedPairing(seasonId, '2026-01-05');
    await insertXtraceGroupIdIdempotent(db, pairing.id, 'grp_preexisting');

    const groupCalls: string[] = [];
    const { client, calls } = makeCapturingXtrace(() => true, groupCalls);
    const report = await runCompanionIngest(makeCtx(), client, AT);

    expect(report.pairingsIngested).toBe(1);
    expect(groupCalls).toEqual([]); // resolveGroupId's getXtraceGroupId read found it first
    expect(calls[0]?.groupIds).toEqual(['grp_preexisting']);
  });

  it('a createGroup failure skips the source (not marked ingested) and counts toward the circuit breaker', async () => {
    const seasonId = await seedSeason();
    // 5 distinct pairings so 5 group-creation failures trip MAX_CONSECUTIVE_FAILURES without
    // relying on any ingest() call ever happening (there is no group id to tag one with).
    for (let i = 0; i < 5; i++) {
      await seedConcludedPairing(seasonId, `2026-0${1 + i}-05`);
    }

    const calls: IngestArgs[] = [];
    const client: XtraceClient = {
      async ingest(args) {
        calls.push(args);
        return true;
      },
      async search() {
        return [];
      },
      async createGroup() {
        return null; // simulates a sustained xTrace outage on group creation
      },
    };

    const report = await runCompanionIngest(makeCtx(), client, AT);

    expect(calls).toHaveLength(0); // never reached — no group id to tag an ingest call with
    expect(report.pairingsSkipped).toBe(5);
    expect(report.pairingsIngested).toBe(0);
    expect(report.aborted).toBe(true); // 5 consecutive group-creation failures tripped the breaker
    expect(await db.select().from(companionIngestLog)).toHaveLength(0);
    expect(await db.select().from(companionXtraceGroups)).toHaveLength(0);
  });

  it('a cache-hit skip (repeat posts on the SAME already-failed pairing) does NOT re-count toward the circuit breaker', async () => {
    // Regression: resolveGroupId's failure bookkeeping must fire only on the fresh
    // createGroup() attempt, not on every later cache-hit skip for the same pairing — otherwise
    // one pairing with many posts trips MAX_CONSECUTIVE_FAILURES (5) almost immediately, on
    // cost-free cache hits that never touched xTrace, aborting the whole run and starving
    // unrelated, perfectly healthy pairings later in the candidate list.
    const seasonId = await seedSeason();
    const host = await seedActivePairingHost(seasonId, '2026-02-02');
    await seedManyPosts(host.id, host.profileAId, 8, AT); // 8 posts, all on the ONE bad pairing
    const healthyHost = await seedActivePairingHost(seasonId, '2026-02-09');
    await seedPost(healthyHost.id, healthyHost.profileAId, 'this one should still go through', AT);

    let createGroupCalls = 0;
    const ingestCalls: IngestArgs[] = [];
    const client: XtraceClient = {
      async ingest(args) {
        ingestCalls.push(args);
        return true;
      },
      async search() {
        return [];
      },
      async createGroup(args) {
        createGroupCalls += 1;
        return args.name.includes(host.id) ? null : 'grp_healthy'; // only the bad pairing fails
      },
    };

    const report = await runCompanionIngest(makeCtx(), client, AT);

    // Exactly ONE real createGroup attempt for the bad pairing (the rest were cache hits) plus
    // one for the healthy pairing — never re-attempted, never re-counted.
    expect(createGroupCalls).toBe(2);
    expect(report.aborted).toBe(false); // 1 real failure, nowhere near MAX_CONSECUTIVE_FAILURES
    expect(report.postsSkipped).toBe(8); // all 8 bad-pairing posts skipped
    expect(report.postsIngested).toBe(1); // the healthy pairing's post still went through
    expect(ingestCalls).toHaveLength(1);
  });
});
