/**
 * WS23-T1 · Journey 2 (docs/journeys-plan.md §5): a market RESOLVES (driven through the real
 * repositories/engine, exactly like `golden-loop.spec.ts` does — not hand-rolled SQL) →
 * the reveal renders the settled state with a streak TICK; and the obituary path fires for a
 * broken run (a streak that dies at an uncovered miss).
 *
 * Resolution is advanced by the SAME functions the worker jobs call — `lockQuestionTx`
 * (`question:lock`), `gradeResolvedQuestionTx` (`grade:followup`), `revealQuestionTx`
 * (`reveal:fire`) and `applyStreakForParticipant` (§6.6) — so the same pick that is seeded goes
 * out through the REAL `GET /questions/:slug/reveal` payload the browser's `RevealSequence`
 * fetches. `POST /internal/revalidate` is called after each transition because `/q/[slug]` is ISR.
 *
 * The obituary half never mocks `**\/reveal` (obituary-wake §1's binding rule): the browser's own
 * reveal fetch derives `broken_run` from really-seeded history. Dailies are seeded at randomized
 * far-future dates (`questions_daily_date_uq` collision-avoidance) and every revealed daily is
 * well-formed (`revealedAt`/`settledAt`/`outcome`/lock snapshots), so the serializer can never 500.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { eq } from 'drizzle-orm';
import {
  applyStreakForParticipant,
  gradeResolvedQuestionTx,
  listRevealedOrVoidedDailyThrough,
  lockQuestionTx,
  markets,
  picks,
  profiles,
  questions,
  revealQuestionTx,
} from '@receipts/db';
import { buildMarket, buildPick, buildQuestion, computeEdge } from '@receipts/db/testing';
import { formatShortDate } from '@/lib/format-et';
import {
  addGhostCookie,
  connectDb,
  randomFutureQuestionDate,
  revalidate,
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

/** A well-formed already-revealed daily for `date`, optionally with a graded pick for `profileId`.
 * Mirrors `obituary-wake.spec.ts`'s `seedRevealedDay`. */
async function seedRevealedDay(
  profileId: string,
  date: string,
  slugPrefix: string,
  opts: { side?: 'yes' | 'no'; entry?: number } = {},
): Promise<{ questionSlug: string; pickId: string | null }> {
  const { db } = handle;
  const market = buildMarket({
    status: 'resolved',
    outcome: 'yes',
    venueMarketId: `KX-JOURNEY2-${randomUUID()}`,
  });
  await db.insert(markets).values(market);
  const revealedAt = new Date();
  const question = buildQuestion(market.id as string, {
    questionDate: date,
    slug: `${slugPrefix}-${date}`,
    status: 'revealed',
    outcome: 'yes',
    yesLabel: 'Yes',
    noLabel: 'No',
    headline: `Did the journey-2 fixture resolve yes on ${date}?`,
    crowdYesAtLock: 6,
    crowdNoAtLock: 4,
    settledAt: revealedAt,
    revealedAt,
  });
  await db.insert(questions).values(question);
  let pickId: string | null = null;
  if (opts.side) {
    const entry = opts.entry ?? 0.6;
    const won = opts.side === 'yes';
    const pick = buildPick(question.id as string, profileId, {
      side: opts.side,
      yesPriceAtEntry: entry,
      result: won ? 'win' : 'loss',
      edge: computeEdge(opts.side, entry, won),
      gradedAt: revealedAt,
    });
    await db.insert(picks).values(pick);
    pickId = pick.id as string;
  }
  return { questionSlug: question.slug as string, pickId };
}

test.describe('Journey 2 · resolve → settled + streak tick', () => {
  test('a seeded pick resolves through the real repositories → WIN + streak tick', async ({
    page,
    context,
    baseURL,
  }) => {
    test.setTimeout(60_000);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const base = baseURL ?? 'http://localhost:3001';

    const ghost = await seedGhost(handle.db);
    await addGhostCookie(context, ghost.profileId, ghost.secret);

    const unique = randomUUID();
    const questionDate = randomFutureQuestionDate();
    const now = Date.now();
    const market = buildMarket({ venueMarketId: `KX-JOURNEY2-OPEN-${unique}`, yesPrice: 0.6 });
    await handle.db.insert(markets).values(market);
    const question = buildQuestion(market.id as string, {
      slug: `journey2-settle-${unique}`,
      questionDate,
      status: 'open',
      openAt: new Date(now - 3600_000),
      lockAt: new Date(now + 3600_000),
      revealAt: new Date(now + 7200_000),
      headline: 'Does the journey-2 market resolve yes?',
    });
    await handle.db.insert(questions).values(question);
    // A real pending pick for the ghost, seeded directly (the pick-placement path itself is
    // journey 1's subject; this journey's subject is resolution/settlement).
    await handle.db.insert(picks).values(
      buildPick(question.id as string, ghost.profileId, {
        side: 'yes',
        yesPriceAtEntry: 0.6,
        result: 'pending',
      }),
    );

    // Drive lock → grade(yes) → reveal → streak, the exact worker-job sequence.
    await handle.db
      .update(questions)
      .set({ lockAt: new Date(Date.now() - 1000) })
      .where(eq(questions.id, question.id as string));
    await lockQuestionTx(handle.db, question.id as string, new Date(), { yesPrice: 0.6 });

    const settledAt = new Date();
    const gradeResult = await gradeResolvedQuestionTx(handle.db, question.id as string, 'yes', settledAt);
    expect(gradeResult.graded).toBe(true);
    expect(gradeResult.winCount).toBe(1);

    const revealedAt = new Date();
    const revealResult = await revealQuestionTx(handle.db, question.id as string, revealedAt);
    expect(revealResult.revealed).toBe(true);

    const dailyHistory = await listRevealedOrVoidedDailyThrough(handle.db, questionDate);
    const streakResult = await applyStreakForParticipant(
      handle.db,
      ghost.profileId,
      dailyHistory,
      questionDate,
      revealedAt,
    );
    expect(streakResult.currentStreak).toBe(1);

    await revalidate(base, `/q/${question.slug}`);
    await page.goto(`/q/${question.slug}`);

    // The settled state + the receipt (WIN) + the streak tick.
    await expect(page.getByTestId('question-revealed')).toBeVisible();
    await expect(page.getByTestId('reveal-sequence-result')).toContainText('WIN');
    await expect(page.getByTestId('reveal-sequence-streak')).toContainText('1');
  });

  test('a broken run → the obituary path (real reveal endpoint, really-seeded history)', async ({
    page,
    context,
  }) => {
    test.setTimeout(60_000);
    const unique = randomUUID();
    const slugPrefix = `journey2-obit-${unique}`;

    const ghost = await seedGhost(handle.db, {
      handle: `Journey Obituary ${unique}`,
      slug: `journey-obituary-${unique}`,
    });
    // Move the profile's identity fields aside so the far-future dates below are the only run.
    await handle.db
      .update(profiles)
      .set({ currentStreak: 0, bestStreak: 3 })
      .where(eq(profiles.id, ghost.profileId));

    // 5 consecutive far-future days: day0..2 = a 3-day run, day3 = uncovered miss, day4 = the wake.
    const year = 2100 + Math.floor(Math.random() * 400);
    const baseDate = new Date(Date.UTC(year, Math.floor(Math.random() * 12), 1 + Math.floor(Math.random() * 20)));
    const d = (offset: number): string => {
      const x = new Date(baseDate);
      x.setUTCDate(x.getUTCDate() + offset);
      return x.toISOString().slice(0, 10);
    };
    const day0 = d(0);
    const day2 = d(2);

    await seedRevealedDay(ghost.profileId, day0, slugPrefix, { side: 'yes', entry: 0.6 });
    await seedRevealedDay(ghost.profileId, d(1), slugPrefix, { side: 'yes', entry: 0.55 });
    await seedRevealedDay(ghost.profileId, day2, slugPrefix, { side: 'yes', entry: 0.29 });
    await seedRevealedDay(ghost.profileId, d(3), slugPrefix); // no pick — the uncovered miss
    const wake = await seedRevealedDay(ghost.profileId, d(4), slugPrefix, { side: 'yes', entry: 0.5 });

    await addGhostCookie(context, ghost.profileId, ghost.secret);

    // The trigger: a real navigation to the return day's reveal. No `page.route` mock anywhere —
    // `RevealSequence`'s own fetch derives `broken_run` from the seeded history.
    await page.goto(`/q/${wake.questionSlug}`);
    await expect(page.getByTestId('reveal-sequence-result')).toBeVisible();

    const obituary = page.getByTestId('obituary-card');
    await expect(obituary).toBeVisible();
    await expect(obituary).toContainText('Here lies a 3-day streak.');
    await expect(obituary).toContainText(
      `b. ${formatShortDate(day0)} — d. ${formatShortDate(day2)}`,
    );
    // The plain share button is replaced by the obituary's own share affordance.
    await expect(page.getByTestId('share-receipt-button')).not.toBeVisible();
    await expect(page.getByTestId('obituary-share')).toBeVisible();
  });
});
