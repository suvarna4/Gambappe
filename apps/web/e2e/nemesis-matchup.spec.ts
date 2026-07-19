/**
 * WS5-T4 E2E: `/vs/[pairingId]`, the public nemesis matchup page (design doc §10.1, §19.3
 * WS7-T6 "matchup page" deliverable), now rendering real Postgres data instead of WS7-T6's
 * original mock (`lib/nemesis/mock-api.ts`) — see that file's header and `apps/web/lib/nemesis/
 * service.ts` for the full handoff explanation. There was no pre-existing e2e coverage of this
 * page to extend (only incidental `nemesis_*` settings-fixture fields appear elsewhere in this
 * `e2e/` directory), so this is new coverage, added per the task's "extend rather than delete
 * blind" instruction where there's something to extend, or add where there isn't.
 *
 * Seeds real rows directly into Postgres (`DATABASE_URL`, migrated by the `e2e` CI job —
 * mirrors `question-page.spec.ts`'s own header note on why: `getPairingPublicById` reads the
 * DB directly for SSR). Uses `nemesis_bonus` questions (linked via `pairing_questions`) rather
 * than `daily` ones — a bonus question's visibility doesn't depend on matching the pairing's
 * `week_start..+6` date window against the real wall-clock "today" the CI run happens to land
 * on, so this stays deterministic regardless of which day it runs (unlike a `daily`-question
 * seed, which `question-page.spec.ts` can afford because IT controls `question_date` directly
 * against a single question, not a week-window range check).
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import {
  connect,
  markets,
  nemesisPairings,
  pairingQuestions,
  picks,
  profiles,
  questions,
  seasons,
  type Db,
} from '@receipts/db';
import { buildMarket, buildNemesisPairing, buildPick, buildProfile, buildQuestion, buildSeason } from '@receipts/db/testing';
import type pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts';

let pool: pg.Pool;
let db: Db;

test.beforeAll(() => {
  ({ pool, db } = connect({ connectionString: DATABASE_URL }));
});

test.afterAll(async () => {
  await pool.end();
});

interface SeededPairing {
  pairingId: string;
  handleA: string;
  handleB: string;
  openQuestionId: string;
  revealedQuestionId: string;
}

/** Fresh UUID/random-suffix defaults throughout (playwright runs `fullyParallel` against one
 * shared Postgres — see `question-page.spec.ts`'s own header note on why this matters). */
async function seedActivePairing(): Promise<SeededPairing> {
  const unique = randomUUID();
  const [profileA, profileB] = await Promise.all([
    db.insert(profiles).values(buildProfile({ kind: 'claimed', status: 'active', handle: `E2E Nemesis A ${unique}` })).returning(),
    db.insert(profiles).values(buildProfile({ kind: 'claimed', status: 'active', handle: `E2E Nemesis B ${unique}` })).returning(),
  ]);
  const [a, b] = [profileA[0]!, profileB[0]!];
  const [aOrdered, bOrdered] = a.id < b.id ? [a, b] : [b, a]; // canonical a < b by uuid (§5.5)

  const [season] = await db.insert(seasons).values(buildSeason({ startsOn: '2026-01-05', endsOn: '2026-12-28' })).returning();

  const [pairing] = await db
    .insert(nemesisPairings)
    .values(
      buildNemesisPairing(season!.id as string, aOrdered.id as string, bOrdered.id as string, {
        weekStart: '2026-07-13',
        status: 'active',
        scoreA: 1,
        scoreB: 0,
        winnerProfileId: null,
      }),
    )
    .returning();

  const now = Date.now();

  // Still open — must render fully masked (§9.3), even though both sides already picked.
  const [openMarket] = await db.insert(markets).values(buildMarket({ venueMarketId: `KX-E2E-NEM-OPEN-${unique}` })).returning();
  const [openQuestion] = await db
    .insert(questions)
    .values(
      buildQuestion(openMarket!.id as string, {
        kind: 'nemesis_bonus',
        questionDate: null,
        slug: `e2e-nemesis-open-${unique}`,
        lockAt: new Date(now + 3_600_000),
        status: 'open',
      }),
    )
    .returning();
  await db.insert(picks).values([
    buildPick(openQuestion!.id as string, aOrdered.id as string, { side: 'yes', result: 'pending' }),
    buildPick(openQuestion!.id as string, bOrdered.id as string, { side: 'no', result: 'pending' }),
  ]);

  // Locked + revealed — must render the real side/result for both.
  const [revealedMarket] = await db
    .insert(markets)
    .values(buildMarket({ venueMarketId: `KX-E2E-NEM-REVEALED-${unique}`, status: 'resolved', outcome: 'yes' }))
    .returning();
  const [revealedQuestion] = await db
    .insert(questions)
    .values(
      buildQuestion(revealedMarket!.id as string, {
        kind: 'nemesis_bonus',
        questionDate: null,
        slug: `e2e-nemesis-revealed-${unique}`,
        lockAt: new Date(now - 3_600_000),
        status: 'revealed',
        outcome: 'yes',
      }),
    )
    .returning();
  await db.insert(picks).values([
    buildPick(revealedQuestion!.id as string, aOrdered.id as string, { side: 'yes', result: 'win', edge: 0.4 }),
    buildPick(revealedQuestion!.id as string, bOrdered.id as string, { side: 'no', result: 'loss', edge: -0.6 }),
  ]);

  await db.insert(pairingQuestions).values([
    { pairingId: pairing!.id as string, questionId: openQuestion!.id as string },
    { pairingId: pairing!.id as string, questionId: revealedQuestion!.id as string },
  ]);

  return {
    pairingId: pairing!.id as string,
    handleA: aOrdered.handle as string,
    handleB: bOrdered.handle as string,
    openQuestionId: openQuestion!.id as string,
    revealedQuestionId: revealedQuestion!.id as string,
  };
}

test.describe('/vs/[pairingId] — public nemesis matchup page (§9.2, §9.3, WS5-T4)', () => {
  test('renders both handles, the running score, and applies §9.3 masking per question', async ({ page }) => {
    const seeded = await seedActivePairing();

    await page.goto(`/vs/${seeded.pairingId}`);

    await expect(page.getByText(seeded.handleA)).toBeVisible();
    await expect(page.getByText(seeded.handleB)).toBeVisible();
    // Score `1–0` per the seeded pairing row (running score, independent of the scoreboard rows).
    await expect(page.getByLabel('Score 1 to 0')).toBeVisible();

    // The still-open bonus question: fully masked for both sides ("· · ·"), even though both
    // sides already picked internally — §9.3 "nothing about whether someone has picked leaks
    // pre-lock either".
    const maskedCells = page.getByLabel(/^Hidden —/);
    await expect(maskedCells).toHaveCount(2);

    // The locked + revealed bonus question: real result visible for both sides (WIN/LOSS
    // stamps — the Stamp component's glyph sits in a sibling `aria-hidden` span, so the
    // label text is matched as a substring of the stamp's full text content, not exact).
    await expect(page.getByText('WIN')).toBeVisible();
    await expect(page.getByText('LOSS')).toBeVisible();
  });

  test('404s for an unknown pairing id', async ({ page }) => {
    const response = await page.goto(`/vs/${randomUUID()}`);
    expect(response?.status()).toBe(404);
  });
});
