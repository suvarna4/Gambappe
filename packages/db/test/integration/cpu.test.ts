/**
 * WS26-T3 integration (docs/plans/cpu-nemesis-wbs.md): CPU repos + roster seeding against a
 * real Postgres. ACs: seeding is idempotent; getCpuPersona only answers for kind='cpu' rows
 * with a known persona; the sweep worklist covers the pairing week's derived dailies AND the
 * pairing's bonus questions, only while open/pre-lock, and drops questions the CPU already
 * picked.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { uuidv7 } from 'uuidv7';
import type pg from 'pg';
import { connect, type Db } from '../../src/client.js';
import {
  CPU_ROSTER,
  getCpuPersona,
  listActiveCpuPairingsWithOpenQuestion,
  seedCpuRoster,
} from '../../src/repositories/cpu.js';
import {
  markets,
  nemesisPairings,
  pairingQuestions,
  picks,
  profiles,
  questions,
  seasons,
} from '../../src/schema/index.js';
import {
  buildCpuProfile,
  buildMarket,
  buildPick,
  buildProfile,
  buildQuestion,
  buildSeason,
} from '../../src/testing/index.js';

const url =
  process.env.TEST_DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts_test';

let pool: pg.Pool;
let db: Db;

// The sweep query compares lock_at/question_date against the DB's real now(), so fixtures
// derive from the real clock — never a pinned date (which would rot).
const NOW = new Date();
const isoDate = (d: Date): string => d.toISOString().slice(0, 10);
/** week_start needn't be a real Monday for the query — any 7-day window containing the
 * fixture daily works. Start it yesterday so a midnight race can't push today outside it. */
const WEEK_START = isoDate(new Date(NOW.getTime() - 24 * 3600_000));

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

describe('seedCpuRoster', () => {
  it('mints one profile per persona, idempotently', async () => {
    const first = await seedCpuRoster(db, NOW);
    const again = await seedCpuRoster(db, NOW);
    expect(again).toEqual(first);
    expect(Object.keys(first).sort()).toEqual(['chalk', 'clock', 'fade', 'longshot']);

    const rows = await db.select().from(profiles);
    const cpus = rows.filter((r) => r.kind === 'cpu');
    expect(cpus).toHaveLength(CPU_ROSTER.length);
    for (const cpu of cpus) {
      expect(cpu.botScore).toBe(1.0); // ≥ BOT_EXCLUDE_THRESHOLD by construction
      expect(cpu.ageAttestedAt).not.toBeNull(); // INV-9 before any pick exists
      expect(cpu.ghostSecretHash).toBeNull();
    }
  });
});

describe('getCpuPersona', () => {
  it('returns the persona for a CPU and null for humans/unknown personas', async () => {
    const roster = await seedCpuRoster(db, NOW);
    expect(await getCpuPersona(db, roster.fade)).toBe('fade');

    const human = buildProfile();
    await db.insert(profiles).values(human);
    expect(await getCpuPersona(db, human.id)).toBeNull();

    const weird = buildCpuProfile('chalk', { cpuPersona: 'crowd_reader' });
    await db.insert(profiles).values(weird);
    expect(await getCpuPersona(db, weird.id)).toBeNull();
  });
});

describe('listActiveCpuPairingsWithOpenQuestion', () => {
  it('lists open week-dailies + bonus questions lacking a CPU pick, and only those', async () => {
    const roster = await seedCpuRoster(db, NOW);
    const human = buildProfile();
    await db.insert(profiles).values(human);

    const season = buildSeason();
    await db.insert(seasons).values(season);
    const pairingId = uuidv7();
    await db.insert(nemesisPairings).values({
      id: pairingId,
      seasonId: season.id,
      weekStart: WEEK_START,
      profileAId: human.id,
      profileBId: roster.chalk,
      status: 'active',
    });

    const market = buildMarket();
    await db.insert(markets).values(market);

    // In-window open daily (in play), out-of-window open daily (not), locked bonus (not),
    // open bonus (in play), open bonus already picked by the CPU (not).
    const dailyIn = buildQuestion(market.id, {
      kind: 'daily',
      status: 'open',
      questionDate: isoDate(NOW),
      lockAt: new Date(NOW.getTime() + 3600_000),
    });
    const dailyOut = buildQuestion(market.id, {
      kind: 'daily',
      status: 'open',
      questionDate: isoDate(new Date(NOW.getTime() - 8 * 24 * 3600_000)),
      lockAt: new Date(NOW.getTime() + 3600_000),
    });
    const bonusLocked = buildQuestion(market.id, {
      kind: 'nemesis_bonus',
      status: 'locked',
      questionDate: null,
      lockAt: new Date(NOW.getTime() - 3600_000),
    });
    const bonusOpen = buildQuestion(market.id, {
      kind: 'nemesis_bonus',
      status: 'open',
      questionDate: null,
      lockAt: new Date(NOW.getTime() + 7200_000),
    });
    const bonusPicked = buildQuestion(market.id, {
      kind: 'nemesis_bonus',
      status: 'open',
      questionDate: null,
      lockAt: new Date(NOW.getTime() + 7200_000),
    });
    await db.insert(questions).values([dailyIn, dailyOut, bonusLocked, bonusOpen, bonusPicked]);
    await db.insert(pairingQuestions).values([
      { pairingId, questionId: bonusLocked.id },
      { pairingId, questionId: bonusOpen.id },
      { pairingId, questionId: bonusPicked.id },
    ]);
    await db.insert(picks).values(buildPick(bonusPicked.id, roster.chalk, { source: 'cpu' }));

    const targets = await listActiveCpuPairingsWithOpenQuestion(db);
    const forPairing = targets.filter((t) => t.pairingId === pairingId);
    expect(forPairing.map((t) => t.questionId).sort()).toEqual([dailyIn.id, bonusOpen.id].sort());
    for (const t of forPairing) {
      expect(t.cpuProfileId).toBe(roster.chalk);
      expect(t.persona).toBe('chalk');
      expect(t.marketId).toBe(market.id);
      expect(t.lockAt.getTime()).toBeGreaterThan(Date.now() - 1);
    }
  });

  it('returns nothing for completed pairings or human-only pairings', async () => {
    const humanA = buildProfile();
    const humanB = buildProfile();
    await db.insert(profiles).values([humanA, humanB]);
    const season = buildSeason();
    await db.insert(seasons).values(season);
    await db.insert(nemesisPairings).values({
      id: uuidv7(),
      seasonId: season.id,
      weekStart: WEEK_START,
      profileAId: humanA.id,
      profileBId: humanB.id,
      status: 'active',
    });
    const targets = await listActiveCpuPairingsWithOpenQuestion(db);
    expect(targets.some((t) => t.cpuProfileId === humanA.id || t.cpuProfileId === humanB.id)).toBe(
      false,
    );
  });
});
