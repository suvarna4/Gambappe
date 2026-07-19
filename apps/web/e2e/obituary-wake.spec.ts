import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { connect, markets, picks, profiles, questions, type Db } from '@receipts/db';
import { buildMarket, buildPick, buildProfile, buildQuestion, computeEdge } from '@receipts/db/testing';
import type pg from 'pg';
import {
  GHOST_COOKIE_NAME,
  buildGhostCookieValue,
  generateGhostSecret,
  hashGhostSecret,
} from '@/lib/ghost-cookie';
import { formatShortDate } from '@/lib/format-et';

/**
 * SW9-T2 (obituary-handoff §2, §3.3(1), §4): the wake, driven against a REAL reveal endpoint
 * over REALLY-SEEDED history — this is the AC's "most important test," the actual proof the
 * `broken_run` → `ObituaryCard` wiring works end to end. §1's post-mortem on the reverted PR #75
 * is explicit: "every test of the trigger path must drive the real reveal endpoint against
 * really-seeded history. No `page.route` payload mocks for trigger semantics" — this file never
 * mocks `**\/reveal`; the browser's own `RevealSequence` fetch hits the real
 * `GET /api/v1/questions/:slug/reveal` route, which derives `broken_run` from real Postgres via
 * `replayStreak` (§3.1/§3.2). The narrower "does the UI branch correctly on a given `broken_run`
 * shape" cases (null, below `OBITUARY_MIN_STREAK`, null `last_pick`, "Bury it", reduced motion)
 * are mocked-payload coverage in `question-page.spec.ts`'s "reveal sequence" describe block —
 * exactly the boundary the design doc draws (mocks are fine once the trigger itself is proven).
 *
 * History is seeded directly into Postgres (5 consecutive daily questions — matching
 * `question-page.spec.ts`'s "revealed: shows the outcome" precedent of inserting already-settled
 * rows wholesale, and `golden-loop.spec.ts`'s header comment #2, which explicitly endorses this
 * as an alternative to driving lock/reveal transitions for cases that don't need to prove the
 * pick-placement path itself — this test's subject is the REVEAL side, not picking). The viewer
 * identity is a real ghost profile with a real `rcpt_gid` cookie valid against
 * `GHOST_COOKIE_SECRET` (same scheme as `apps/web/load-tests/seed.ts`, §6.1.1), set directly on
 * the browser context — so the reveal route resolves a genuine identity, not a mocked one.
 *
 * Dates: 5 CONSECUTIVE far-future calendar days (day0..day2 = the run, day3 = the uncovered
 * miss, day4 = the return/wake reveal) drawn from a huge randomized range — the same
 * collision-avoidance golden-loop's header comment #1 documents (`questions_daily_date_uq`
 * allows only one `kind='daily'` row per date globally, and this suite runs
 * `fullyParallel: true` against one shared Postgres).
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

/** A random far-future UTC date (year 2100-2500) — collision-proof against the real "today",
 * every other fixture/factory's date range, and (with overwhelming probability given the huge
 * range) any other test's own randomized date — see header comment. */
function randomFutureBaseDate(): Date {
  const year = 2100 + Math.floor(Math.random() * 400);
  const month = Math.floor(Math.random() * 12); // 0-indexed for Date.UTC
  const day = 1 + Math.floor(Math.random() * 25); // stays clear of month-length edge cases
  return new Date(Date.UTC(year, month, day));
}

function dateString(base: Date, offsetDays: number): string {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

interface SeededDay {
  question: ReturnType<typeof buildQuestion>;
  pick: ReturnType<typeof buildPick> | null;
}

/**
 * One already-revealed real daily question for `date`, optionally with a graded pick for
 * `profileId`. Mirrors `test/integration/busted-streak-binding.test.ts`'s `seedDay` helper
 * (the same primitive SW9-T1/T3 already established for this exact kind of history fixture),
 * adapted to insert against the shared e2e Postgres rather than a per-suite truncated one.
 */
async function seedRevealedDay(
  profileId: string,
  date: string,
  slugPrefix: string,
  opts: { side?: 'yes' | 'no'; entry?: number } = {},
): Promise<SeededDay> {
  // `buildMarket`'s default `venueMarketId` keys off the same per-process counter as
  // `buildProfile`'s default handle (see the profile-seeding comment above) — force a unique
  // one explicitly, matching `question-page.spec.ts`'s `seedQuestion` precedent.
  const market = buildMarket({
    status: 'resolved',
    outcome: 'yes',
    venueMarketId: `KX-OBIT-WAKE-${randomUUID()}`,
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
    headline: `Did the obituary-wake fixture resolve yes on ${date}?`,
    crowdYesAtLock: 6,
    crowdNoAtLock: 4,
    settledAt: revealedAt,
    revealedAt,
  });
  await db.insert(questions).values(question);

  let pick: ReturnType<typeof buildPick> | null = null;
  if (opts.side) {
    const entry = opts.entry ?? 0.6;
    const won = opts.side === 'yes';
    pick = buildPick(question.id as string, profileId, {
      side: opts.side,
      yesPriceAtEntry: entry,
      result: won ? 'win' : 'loss',
      edge: computeEdge(opts.side, entry, won),
      gradedAt: revealedAt,
    });
    await db.insert(picks).values(pick);
  }
  return { question, pick };
}

test.describe('SW9-T2 obituary wake (obituary-handoff §2, §4) — real reveal endpoint, real seeded history', () => {
  test('a >=3-day run + an uncovered miss + a return-day reveal renders the obituary card, and its share button targets the death pick on the death question page', async ({
    page,
  }) => {
    test.setTimeout(30_000);
    const unique = randomUUID();
    const base = randomFutureBaseDate();
    const day0 = dateString(base, 0);
    const day1 = dateString(base, 1);
    const day2 = dateString(base, 2); // the run's final answered day — "Died holding …"
    const day3 = dateString(base, 3); // uncovered miss — kills the run
    const day4 = dateString(base, 4); // return day — the wake

    // A real ghost profile with a real rcpt_gid cookie (see header comment) — not a mocked
    // identity. `buildProfile`'s default handle/slug key off an in-memory counter that resets
    // per process (`packages/db/src/testing/factories.ts`), which collides across repeated
    // local runs against this suite's persistent, never-truncated `receipts` database (unlike
    // CI's fresh-per-job Postgres service container) — force a unique handle/slug explicitly,
    // matching `question-page.spec.ts`'s own `seedQuestion` header comment on the same hazard.
    const secret = generateGhostSecret();
    const profile = buildProfile({
      handle: `Obituary Wake ${unique}`,
      slug: `obituary-wake-${unique}`,
      ghostSecretHash: hashGhostSecret(secret),
    });
    await db.insert(profiles).values(profile);
    const profileId = profile.id as string;

    const slugPrefix = `obituary-wake-${unique}`;
    await seedRevealedDay(profileId, day0, slugPrefix, { side: 'yes', entry: 0.6 });
    await seedRevealedDay(profileId, day1, slugPrefix, { side: 'yes', entry: 0.55 });
    const death = await seedRevealedDay(profileId, day2, slugPrefix, { side: 'yes', entry: 0.29 });
    await seedRevealedDay(profileId, day3, slugPrefix); // no pick — the uncovered miss
    const { question: returnQuestion } = await seedRevealedDay(profileId, day4, slugPrefix, {
      side: 'yes',
      entry: 0.5,
    });

    await page.context().addCookies([
      {
        name: GHOST_COOKIE_NAME,
        value: buildGhostCookieValue(profileId, secret),
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
      },
    ]);

    // The trigger: a real browser navigation to the return day's question page. No
    // `page.route` mock anywhere in this test — `RevealSequence`'s own client fetch hits the
    // real reveal route, which derives `broken_run` from the really-seeded history above.
    await page.goto(`/q/${returnQuestion.slug}`);
    await expect(page.getByTestId('reveal-sequence-result')).toBeVisible();

    // The wake fired: the obituary card, not the plain share button.
    await expect(page.getByTestId('obituary-card')).toBeVisible();
    await expect(page.getByTestId('share-receipt-button')).not.toBeVisible();
    await expect(page.getByTestId('obituary-card')).toContainText('Here lies a 3-day streak.');
    await expect(page.getByTestId('obituary-card')).toContainText(
      `b. ${formatShortDate(day0)} — d. ${formatShortDate(day2)}`,
    );
    await expect(page.getByTestId('obituary-card')).toContainText('Died holding Yes @ 29¢.');

    // "Share the obituary" targets the DEATH pick (day2's), on the death question's page —
    // never this reveal's own pick/question.
    await page.getByTestId('obituary-share').click();
    const sheet = page.getByTestId('share-sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet.getByTestId('share-preview-image')).toHaveAttribute(
      'src',
      new RegExp(`/api/cards/receipt/${death.pick!.id}\\?format=square`),
    );

    // Copy-link confirms the page URL itself lands on the death question, not the current one
    // (`pagePath` = `/q/${last_pick.question_slug}` — the contract's whole reason for carrying
    // `question_slug`, per the SW9-T2 task brief).
    await sheet.getByTestId('share-copy-link').click();
    await expect(sheet.getByTestId('share-copy-link')).toContainText('Copied!');
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toContain(`/q/${death.question.slug}`);
    expect(clipboardText).not.toContain(`/q/${returnQuestion.slug}`);
  });
});
