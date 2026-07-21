/**
 * WS23-T1 · Journey 4 (docs/journeys-plan.md §5): a SAME-SIDE nemesis week — both rivals take YES
 * at DIFFERENT entry prices → the matchup is decided by price EDGE (D-J4): the cheaper entry wins
 * the day. Driven against the REAL reveal endpoint over really-seeded nemesis history, exactly like
 * `nemesis-flip.spec.ts` (no `**\/reveal` payload mock for trigger semantics).
 *
 * Where the SAME-SIDE surface renders: the same-side result data (`nemesis_flip.same_side`, the
 * viewer-relative `{ your_price, their_price, winner }` edge verdict) lives ONLY on the
 * viewer-scoped, client-fetched reveal payload (`SameSideState`'s own SEAL-SAFETY doc) — it is
 * never on the viewer-free ISR pairing shell. So this journey proves the edge winner from that real
 * payload (the source of truth), AND that both rivals are on the SAME side on the rendered reveal;
 * the `SAME SIDE · EDGE DECIDES` tape itself (`SameSideState`) is asserted on `/dev/ui`, the only
 * surface that mounts it (no production route feeds it real same-side data today — WS20-T2's card
 * is wired into `NemesisMatchupCard`/`VerdictCard`, which pass `sameSide` only from this same
 * payload).
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { markets, nemesisPairings, picks, questions, seasons } from '@receipts/db';
import {
  buildMarket,
  buildNemesisPairing,
  buildPick,
  buildQuestion,
  buildSeason,
  computeEdge,
} from '@receipts/db/testing';
import {
  addGhostCookie,
  connectDb,
  seedGhost,
  type DbHandle,
} from './_journey-helpers';

let handle: DbHandle;

test.beforeAll(() => {
  handle = connectDb();
});

test.afterAll(async () => {
  await handle.pool.end();
});

/** A random far-future date (also the pairing's week_start), collision-proof per the shared rule. */
function randomFutureDate(): string {
  const year = 2100 + Math.floor(Math.random() * 400);
  const month = Math.floor(Math.random() * 12);
  const day = 1 + Math.floor(Math.random() * 25);
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

test.describe('Journey 4 · same-side week → day winner by edge (D-J4)', () => {
  test('both rivals pick YES at different prices → SAME SIDE, cheaper entry takes the day', async ({
    page,
    context,
  }) => {
    test.setTimeout(60_000);
    const unique = randomUUID();
    const questionDate = randomFutureDate();

    const viewer = await seedGhost(handle.db, {
      handle: `Journey SameSide Viewer ${unique}`,
      slug: `journey-sameside-viewer-${unique}`,
    });
    const opponent = await seedGhost(handle.db, {
      handle: `Journey SameSide Rival ${unique}`,
      slug: `journey-sameside-rival-${unique}`,
    });

    const [season] = await handle.db
      .insert(seasons)
      .values(buildSeason({ startsOn: questionDate, endsOn: '2500-12-31' }))
      .returning();
    await handle.db.insert(nemesisPairings).values(
      buildNemesisPairing(season!.id as string, viewer.profileId, opponent.profileId, {
        weekStart: questionDate,
        status: 'active',
        scoreA: 0,
        scoreB: 0,
        winnerProfileId: null,
      }),
    );

    const market = buildMarket({
      status: 'resolved',
      outcome: 'yes',
      venueMarketId: `KX-JOURNEY4-${randomUUID()}`,
    });
    await handle.db.insert(markets).values(market);
    const revealedAt = new Date();
    const question = buildQuestion(market.id as string, {
      questionDate,
      slug: `journey-sameside-${unique}`,
      status: 'revealed',
      outcome: 'yes',
      yesLabel: 'Yes it will',
      noLabel: 'No it will not',
      // §9.3 masking reads real wall-clock lock_at — force it into the real past so the pairing
      // scoreboard replay sees BOTH sides (the far-future question_date is collision-proofing only).
      lockAt: new Date(Date.now() - 3600_000),
      crowdYesAtLock: 6,
      crowdNoAtLock: 4,
      settledAt: revealedAt,
      revealedAt,
    });
    await handle.db.insert(questions).values(question);

    // Both pick YES; the viewer entered CHEAPER (0.40 vs 0.70) → the viewer wins the day on price.
    await handle.db.insert(picks).values([
      buildPick(question.id as string, viewer.profileId, {
        side: 'yes',
        yesPriceAtEntry: 0.4,
        result: 'win',
        edge: computeEdge('yes', 0.4, true),
        gradedAt: revealedAt,
      }),
      buildPick(question.id as string, opponent.profileId, {
        side: 'yes',
        yesPriceAtEntry: 0.7,
        result: 'win',
        edge: computeEdge('yes', 0.7, true),
        gradedAt: revealedAt,
      }),
    ]);

    await addGhostCookie(context, viewer.profileId, viewer.secret);

    // --- the reveal renders: the rival is on the SAME (YES) side --------------------------------
    await page.goto(`/q/${question.slug}`);
    await expect(page.getByTestId('reveal-sequence-result')).toContainText('WIN');
    const flip = page.getByTestId('nemesis-flip');
    await expect(flip).toBeVisible();
    await expect(flip).toContainText(opponent.handle);
    await expect(flip).toContainText('Yes it will @ 70¢'); // rival: YES, entered at 70¢

    // --- the day winner by EDGE, from the real reveal payload (the same-side source of truth) ---
    const revealRes = await page.request.get(`/api/v1/questions/${question.slug}/reveal`);
    expect(revealRes.status()).toBe(200);
    const body = (await revealRes.json()) as {
      data: { viewer?: { nemesis_flip?: { same_side?: { your_price: number; their_price: number; winner: string } } } };
    };
    expect(body.data.viewer?.nemesis_flip?.same_side).toEqual({
      your_price: 40,
      their_price: 70,
      winner: 'you',
    });

    // --- the SAME SIDE · EDGE DECIDES surface renders (SameSideState, on /dev/ui) ---------------
    await page.goto('/dev/ui');
    const sameSide = page.getByTestId('same-side-state').first();
    await expect(sameSide).toBeVisible();
    await expect(sameSide).toContainText('SAME SIDE · EDGE DECIDES');
  });
});
