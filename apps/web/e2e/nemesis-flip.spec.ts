import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import {
  connect,
  markets,
  nemesisPairings,
  picks,
  profiles,
  questions,
  seasons,
  type Db,
} from '@receipts/db';
import { buildMarket, buildNemesisPairing, buildPick, buildProfile, buildQuestion, buildSeason, computeEdge } from '@receipts/db/testing';
import type pg from 'pg';
import {
  GHOST_COOKIE_NAME,
  buildGhostCookieValue,
  generateGhostSecret,
  hashGhostSecret,
} from '@/lib/ghost-cookie';
import { formatShortDate } from '@/lib/format-et';

/**
 * SW10-T1 (wiring-gaps doc §4 SW10-T1): the nemesis daily "flip", driven against a REAL reveal
 * endpoint over REALLY-SEEDED nemesis history — matching `obituary-wake.spec.ts`'s (SW9-T2)
 * binding rule: "every test of the trigger path must drive the real reveal endpoint against
 * really-seeded history. No `page.route` payload mocks for trigger semantics." This file never
 * mocks `**\/reveal` — the browser's own `RevealSequence` fetch hits the real
 * `GET /api/v1/questions/:slug/reveal` route, which derives `nemesis_flip` from a real active
 * `nemesis_pairings` row + a real opponent pick via `computeNemesisFlipBlock`
 * (`apps/web/lib/reveal-payload.ts`). The narrower "does the UI branch correctly on a given
 * `nemesis_flip` shape" cases (null, narration: null) are mocked-payload coverage in
 * `question-page.spec.ts`'s "reveal sequence" describe block, matching that file's SW9 pattern.
 *
 * `FLAG_NEMESIS` defaults to `'true'` for the whole e2e suite (`playwright.config.ts`).
 */

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts';

let pool: pg.Pool;
let db: Db;

test.beforeAll(() => {
  ({ pool, db } = connect({ connectionString: DATABASE_URL }));
});

test.afterAll(async () => {
  await pool.end();
});

/** A random far-future UTC date (year 2100-2500) — collision-proof, matching
 * `obituary-wake.spec.ts`'s header comment on why this is needed under `fullyParallel: true`
 * against one shared Postgres. */
function randomFutureDate(): string {
  const year = 2100 + Math.floor(Math.random() * 400);
  const month = Math.floor(Math.random() * 12);
  const day = 1 + Math.floor(Math.random() * 25);
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

test.describe('SW10-T1 nemesis daily flip (wiring-gaps doc §4 SW10-T1) — real reveal endpoint, real seeded pairing', () => {
  test('two real profiles in an active pairing, both pick the same real daily question, the question reveals for real — NemesisFlip renders with the real opponent stamp on the viewer\'s reveal', async ({
    page,
  }) => {
    test.setTimeout(30_000);
    const unique = randomUUID();
    const questionDate = randomFutureDate(); // also this pairing's week_start (day 1 of the week)

    // Two real ghost profiles — the viewer authenticates via a real `rcpt_gid` cookie (matching
    // `obituary-wake.spec.ts`'s header on why this is a genuine identity, not a mocked one); the
    // opponent needs no cookie at all (their pick is read server-side).
    const secret = generateGhostSecret();
    const viewer = buildProfile({
      handle: `Flip Viewer ${unique}`,
      slug: `flip-viewer-${unique}`,
      ghostSecretHash: hashGhostSecret(secret),
    });
    const opponent = buildProfile({ handle: `Flip Opponent ${unique}`, slug: `flip-opponent-${unique}` });
    await db.insert(profiles).values([viewer, opponent]);

    const [season] = await db.insert(seasons).values(buildSeason({ startsOn: questionDate, endsOn: '2500-12-31' })).returning();
    await db.insert(nemesisPairings).values(
      buildNemesisPairing(season!.id, viewer.id as string, opponent.id as string, {
        weekStart: questionDate,
        status: 'active',
        // Deliberately zeroed (SW10-T1 fable round 5 HIGH finding) — these columns are only
        // written at week conclusion; the real emitted tally must come from a scoreboard
        // replay, not from here.
        scoreA: 0,
        scoreB: 0,
      }),
    );

    const market = buildMarket({ status: 'resolved', outcome: 'yes', venueMarketId: `KX-NEMESIS-FLIP-${randomUUID()}` });
    await db.insert(markets).values(market);
    const revealedAt = new Date();
    const question = buildQuestion(market.id as string, {
      questionDate,
      slug: `nemesis-flip-${unique}`,
      status: 'revealed',
      outcome: 'yes',
      yesLabel: 'Yes it will',
      noLabel: 'No it will not',
      // §9.3 masking reads real wall-clock `lock_at` (not `question_date`, and `question_date`
      // is a far-future collision-proofing fixture here, not the real clock) — the default
      // test-factory `lockAt` sits a couple hours after real "now", which would leave the
      // pairing scoreboard's `a`/`b` masked (both null) even though `status` is `revealed`.
      // Force it into the real past so the scoreboard replay actually sees both sides.
      lockAt: new Date(Date.now() - 3600_000),
      crowdYesAtLock: 6,
      crowdNoAtLock: 4,
      settledAt: revealedAt,
      revealedAt,
    });
    await db.insert(questions).values(question);

    // Viewer picks YES and wins; opponent picks NO and loses.
    await db.insert(picks).values([
      buildPick(question.id as string, viewer.id as string, {
        side: 'yes',
        yesPriceAtEntry: 0.6,
        result: 'win',
        edge: computeEdge('yes', 0.6, true),
        gradedAt: revealedAt,
      }),
      buildPick(question.id as string, opponent.id as string, {
        side: 'no',
        yesPriceAtEntry: 0.7, // implied NO price = 1-0.7 = 0.3 -> 30c
        result: 'loss',
        edge: computeEdge('no', 0.7, false),
        gradedAt: revealedAt,
      }),
    ]);

    await page.context().addCookies([
      {
        name: GHOST_COOKIE_NAME,
        value: buildGhostCookieValue(viewer.id as string, secret),
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
      },
    ]);

    // The trigger: a real browser navigation to the question page. No `page.route` mock of the
    // reveal endpoint anywhere in this test.
    await page.goto(`/q/${question.slug}`);
    await expect(page.getByTestId('reveal-sequence-result')).toBeVisible();
    await expect(page.getByTestId('reveal-sequence-result')).toContainText('WIN');

    const flip = page.getByTestId('nemesis-flip');
    await expect(flip).toBeVisible();
    await expect(flip).toContainText(opponent.handle as string);
    await expect(flip).toContainText('No it will not @ 30¢');
    // Sole shared question, week-start === question_date -> before-tally tied 0-0, after 1-0:
    // the leader flipped to the viewer (`nemesis_lead_taken`).
    await expect(flip).toContainText('You lead 1–0');
    await expect(flip).toContainText('takes the lead, 1–0, with 0 questions left.');
    await expect(flip).toContainText(`${formatShortDate(questionDate)} · Day 1`);

    // Alongside, never replacing, the existing result/share content.
    await expect(page.getByTestId('share-receipt-button')).toBeVisible();
  });

  test('no active pairing: today\'s reveal renders byte-identical (no nemesis-flip section)', async ({
    page,
  }) => {
    test.setTimeout(30_000);
    const unique = randomUUID();
    const questionDate = randomFutureDate();

    const secret = generateGhostSecret();
    const viewer = buildProfile({
      handle: `Flip NoPairing ${unique}`,
      slug: `flip-no-pairing-${unique}`,
      ghostSecretHash: hashGhostSecret(secret),
    });
    await db.insert(profiles).values(viewer);

    const market = buildMarket({ status: 'resolved', outcome: 'yes', venueMarketId: `KX-NEMESIS-FLIP-NOPAIR-${randomUUID()}` });
    await db.insert(markets).values(market);
    const revealedAt = new Date();
    const question = buildQuestion(market.id as string, {
      questionDate,
      slug: `nemesis-flip-nopair-${unique}`,
      status: 'revealed',
      outcome: 'yes',
      settledAt: revealedAt,
      revealedAt,
    });
    await db.insert(questions).values(question);
    await db.insert(picks).values(
      buildPick(question.id as string, viewer.id as string, {
        side: 'yes',
        yesPriceAtEntry: 0.6,
        result: 'win',
        edge: computeEdge('yes', 0.6, true),
        gradedAt: revealedAt,
      }),
    );

    await page.context().addCookies([
      {
        name: GHOST_COOKIE_NAME,
        value: buildGhostCookieValue(viewer.id as string, secret),
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
      },
    ]);

    await page.goto(`/q/${question.slug}`);
    await expect(page.getByTestId('reveal-sequence-result')).toBeVisible();
    await expect(page.getByTestId('nemesis-flip')).toHaveCount(0);
  });
});
