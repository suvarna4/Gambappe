import { randomUUID } from 'node:crypto';
import { PRODUCT_NAME } from '@receipts/core';
import { expect, test } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { Redis } from 'ioredis';
import {
  applyStreakForParticipant,
  connect,
  gradeResolvedQuestionTx,
  listRevealedOrVoidedDailyThrough,
  lockQuestionTx,
  markets,
  questions,
  revealQuestionTx,
  sessions,
  users,
  type Db,
} from '@receipts/db';
import { buildMarket, buildQuestion } from '@receipts/db/testing';
import type pg from 'pg';

/**
 * WS14-T1: the "golden loop" (design doc §17.1's third bullet, §19.3 WS14-T1 AC). Every other
 * file in this directory is a narrow per-feature spec (claim UI wiring, one question-page state,
 * the share sheet in isolation, ...); this is the one suite that chains the CORE user journey —
 * spectate → pick → lock → reveal → claim → profile → share — through REAL HTTP routes against
 * REAL Postgres/Redis in one continuous flow, the way §19.3 frames it: "if this one test suite
 * is green, the product's core promise works end-to-end." It exists to catch integration breaks
 * a narrow spec can't (e.g. a pick-route change that silently breaks the reveal payload's shape,
 * even though each route's own isolated test still passes) — so this file stays a SMALL number
 * of comprehensive tests, not another pile of narrow ones.
 *
 * Three deliberate scope boundaries, each matching an established convention elsewhere in this
 * repo rather than inventing a new one:
 *
 * 1. **Entry surface is `/q/[slug]`, not `/`.** `questions_daily_date_uq` (schema) allows only
 *    ONE `kind='daily'` row globally per `question_date` — the whole app has exactly one
 *    "today" at a time. Every existing spec that seeds a question sidesteps this by passing
 *    `questionDate: null` (see `question-page.spec.ts`, `question-thread.spec.ts`,
 *    `oembed-sitemap.spec.ts`) rather than fighting over the single real "today" row, which
 *    would flake under `fullyParallel: true` (concurrent workers) and CI's own retries (a
 *    retry on the same calendar day collides with its own first attempt). This spec seeds a
 *    `questionDate` far in the future (year 2100+, randomized) instead of `null` — a synthetic
 *    "today" collision-free with real seed data, every other spec, AND with itself on retry —
 *    specifically so the real streak-replay machinery (§6.6, keyed on `question_date`) has
 *    something to replay for the profile-page assertion below. `/` itself gets one decoupled
 *    smoke check (does it render at all) rather than asserting on seeded content it may not
 *    hold.
 *
 * 2. **Lock/reveal are advanced via direct repository calls, not the real worker cron.** Per
 *    §17.2 ("seeding/advancing question state directly ... rather than waiting on the real
 *    worker cron") and matching `question-page.spec.ts`'s win-reveal test precedent. The
 *    difference here: rather than inserting an already-`revealed` row wholesale, this test
 *    places a REAL pick through the REAL API first, then calls the exact repository functions
 *    the worker jobs call (`lockQuestionTx`/`gradeResolvedQuestionTx`/`revealQuestionTx`/
 *    `applyStreakForParticipant` — `apps/worker/src/jobs/{question-lifecycle,grade-followup,
 *    reveal-fire}.ts`) so the SAME pick that went in through the API is the one that comes back
 *    out through the real `GET /questions/:slug/reveal` payload and the real profile page.
 *    `POST /internal/revalidate` is called after each transition (real bearer-secret-gated
 *    route, §9.2) because `/q/[slug]` is ISR (revalidate 30s) — without it, a second
 *    `page.goto` to the same already-cached slug within the 30s window would serve stale HTML.
 *
 * 3. **Claim completion bypasses the OAuth/email hop via a directly-seeded Auth.js session,
 *    not a real magic-link click-through.** `claim-flow.spec.ts`'s own header comment already
 *    documents why: "no real Google credentials in this sandbox, and the email provider's
 *    'click the emailed link' step happens out of band." A second, harder blocker for actually
 *    completing it here: `apps/web/auth.ts`'s magic-link stub only records to the in-memory
 *    mailbox when `NODE_ENV !== 'production'`, but `next start` (this suite's `webServer`,
 *    `playwright.config.ts`) hard-forces `NODE_ENV=production` — so the stub throws instead of
 *    ever recording a link, in every e2e run, not just this sandbox's credential gap. Rather
 *    than weakening that production gate (a real account-takeover surface if it slipped into an
 *    actual prod deploy) just to make one test's click-through automatable, this test verifies
 *    the pre-auth UI wiring (ghost confirmation card, sign-in options) exactly like
 *    `claim-flow.spec.ts` does, then bridges the one genuinely unautomatable hop the same way
 *    step 2 above bridges lock/reveal: a direct, real `users` + `sessions` row (Auth.js
 *    "database" strategy validates sessions by a raw `sessions.session_token` equality lookup,
 *    `@auth/drizzle-adapter`'s `getSessionAndUser` — no signing/hashing involved, unlike the
 *    email verification-token path) with the cookie set on the browser context. Everything
 *    downstream of that — the real `POST /api/v1/claim` call, the real case-A ghost→claimed
 *    transition (§6.3/§6.4, DD-4), the real age-attestation retry (INV-9) — runs for real.
 */

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts';
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

// `next start` always runs with `NODE_ENV=production` regardless of the shell's env (Next.js
// hard-codes this) — so `useSecureCookies` (`apps/web/auth.ts`) is always true for this suite,
// and the session cookie is always the `__Secure-` prefixed name (`apps/web/lib/auth-cookies.ts`
// `sessionCookieConfig`). Chromium treats `http://localhost` as a secure context for cookie
// purposes, so a `Secure` cookie set on `baseURL` (`http://localhost:3000`) still round-trips.
const SESSION_COOKIE_NAME = '__Secure-authjs.session-token';

let pool: pg.Pool;
let db: Db;
let redis: Redis;

test.beforeAll(() => {
  ({ pool, db } = connect({ connectionString: DATABASE_URL }));
  redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
});

test.afterAll(async () => {
  await pool.end();
  redis.disconnect();
});

/** See header comment #1 — a synthetic, collision-free `question_date` far outside both real
 * "today" and every other fixture/factory's date range, so §6.6 streak replay has exactly one
 * (this test's own) revealed daily to work with. */
function randomFutureQuestionDate(): string {
  const year = 2100 + Math.floor(Math.random() * 400);
  const month = String(1 + Math.floor(Math.random() * 12)).padStart(2, '0');
  const day = String(1 + Math.floor(Math.random() * 28)).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function seedOpenDailyQuestion() {
  const unique = randomUUID();
  const now = Date.now();
  const market = buildMarket({ venueMarketId: `KX-GOLDEN-${unique}`, yesPrice: 0.6 });
  await db.insert(markets).values(market);
  // Prime the real Redis price cache the pick route's §6.2 step 4 ladder reads first
  // (`price:{venue}:{venueMarketId}`, `apps/web/lib/price-stamp.ts`) — mirrors what the
  // worker's `venue:price-tick` job keeps warm in production, and keeps this test off the
  // ladder's live-venue-adapter fallback entirely (no `KALSHI_API_BASE` reachable in e2e, and a
  // real network attempt — even one that fails fast — is both unrealistic for this synchronous
  // path and, under CI load, a source of exactly the timing flakiness §19.3's AC (<1% flake
  // rate) cares about).
  await redis.set(
    `price:${market.venue}:${market.venueMarketId}`,
    JSON.stringify({ yesPrice: 0.6, ts: new Date().toISOString() }),
  );
  const question = buildQuestion(market.id as string, {
    slug: `golden-loop-${unique}`,
    questionDate: randomFutureQuestionDate(),
    status: 'open',
    openAt: new Date(now - 3_600_000),
    lockAt: new Date(now + 3_600_000),
    revealAt: new Date(now + 7_200_000),
    headline: 'Will the golden loop question resolve yes?',
    yesLabel: 'Yes it will',
    noLabel: 'No it will not',
  });
  await db.insert(questions).values(question);
  return { market, question };
}

/** Revalidates the ISR cache for `path` via the real worker→web hook (§9.2) — see header
 * comment #2 for why this is required between DB-side state transitions and the next
 * `page.goto` of the same already-visited slug. */
async function revalidate(baseURL: string, path: string): Promise<void> {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) throw new Error('INTERNAL_API_SECRET is not set (see playwright.config.ts)');
  const res = await fetch(`${baseURL}/api/v1/internal/revalidate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
    body: JSON.stringify({ paths: [path] }),
  });
  expect(res.status, 'POST /internal/revalidate should succeed').toBe(200);
  const body = (await res.json()) as { data: { revalidated: string[]; rejected: string[] } };
  expect(body.data.rejected).toEqual([]);
}

/** See header comment #3 — a real Auth.js "database" strategy session, seeded directly rather
 * than completed via an unautomatable OAuth/email round trip. */
async function seedClaimSession(): Promise<{ sessionToken: string; email: string }> {
  const userId = randomUUID();
  const email = `golden-loop-${randomUUID()}@example.test`;
  await db.insert(users).values({ id: userId, email, ageAttestedAt: null });
  const sessionToken = randomUUID();
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await db.insert(sessions).values({ sessionToken, userId, expires });
  return { sessionToken, email };
}

test.describe('WS14-T1 golden loop (§17.1)', () => {
  test('ghost picks the open daily → locks → reveals with streak → claims → profile → shares', async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(60_000);
    // Deterministic, faster reveal-sequence assertions (skips the artificial stage-stagger
    // delay in `RevealSequence`, §10.3) — same posture as `question-page.spec.ts`'s own
    // reduced-motion reveal test.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const base = baseURL ?? 'http://localhost:3000';

    // --- 1. spectator lands on the question page, sees the open daily -----------------------
    const { question } = await seedOpenDailyQuestion();
    await page.goto(`/q/${question.slug}`);
    await expect(page.getByTestId('question-open')).toBeVisible();
    await expect(page.getByTestId('viewer-strip-pick-buttons')).toBeVisible();

    // --- 2. places a pick (first-pick age-gate flow, §6.2/INV-9) — real POST, real Postgres --
    await page.getByTestId('pick-yes').click();
    await expect(page.getByTestId('age-gate')).toBeVisible();
    await page.getByTestId('age-gate-confirm').click();
    await expect(page.getByTestId('viewer-strip-pick')).toBeVisible();
    await expect(page.getByTestId('viewer-strip-pick')).toContainText('Yes');

    const meRes = await page.request.get('/api/v1/me');
    expect(meRes.status()).toBe(200);
    const me = (await meRes.json()).data as {
      profile: { profile_id: string; handle: string; slug: string };
    };
    const profileId = me.profile.profile_id;
    const profileSlug = me.profile.slug;
    const ghostHandle = me.profile.handle;

    // --- 3. question locks (direct repository call — real worker cron isn't running in e2e,
    //        §17.2) --------------------------------------------------------------------------
    // `deriveEffectiveStatus` (`lib/question-view.ts`, §5.7) derives the open/locked read-side
    // split PURELY from whether `lock_at` has passed — never from the raw `status` column
    // (only `revealed`/`voided`/`draft` short-circuit that). In production this is always
    // already true by the time a real `question:lock` job flips the row (the job fires AT
    // `lock_at`); here `lock_at` was seeded an hour out so the earlier real pick could land, so
    // it has to be walked back into the past too, or the page would keep rendering `open`
    // forever regardless of what `lockQuestionTx` sets `status` to.
    await db
      .update(questions)
      .set({ lockAt: new Date(Date.now() - 1_000) })
      .where(eq(questions.id, question.id));
    await lockQuestionTx(db, question.id, new Date(), { yesPrice: 0.6 });
    await revalidate(base, `/q/${question.slug}`);
    await page.goto(`/q/${question.slug}`);
    await expect(page.getByTestId('question-locked')).toBeVisible();

    // Grade (side='yes' picked, outcome='yes' → a WIN) then reveal, then apply the real §6.6
    // streak increment — the exact sequence + functions `grade:followup`/`reveal:fire` use.
    const settledAt = new Date();
    const gradeResult = await gradeResolvedQuestionTx(db, question.id, 'yes', settledAt);
    expect(gradeResult.graded).toBe(true);
    expect(gradeResult.winCount).toBe(1);
    const revealedAt = new Date();
    const revealResult = await revealQuestionTx(db, question.id, revealedAt);
    expect(revealResult.revealed).toBe(true);
    const questionDate = question.questionDate as string;
    const dailyHistory = await listRevealedOrVoidedDailyThrough(db, questionDate);
    const streakResult = await applyStreakForParticipant(
      db,
      profileId,
      dailyHistory,
      questionDate,
      revealedAt,
    );
    expect(streakResult.currentStreak).toBe(1);

    // --- 4. reveals — the visitor sees their receipt (win) + streak update ------------------
    await revalidate(base, `/q/${question.slug}`);
    await page.goto(`/q/${question.slug}`);
    await expect(page.getByTestId('question-revealed')).toBeVisible();
    await expect(page.getByTestId('reveal-sequence-result')).toBeVisible();
    await expect(page.getByTestId('reveal-sequence-result')).toContainText('WIN');
    await expect(page.getByTestId('reveal-sequence-streak')).toContainText('1');

    // --- 4b. (optional) shares the receipt via the real share sheet (WS8-T2) ----------------
    // `ShareSheet` mints the real share token in a `useEffect` gated on `open` (fires the
    // instant the sheet mounts, not on the later "Copy link" click — `handleCopyLink` just
    // writes the already-minted URL to the clipboard, no second network call) — the listener
    // has to be armed BEFORE the click that opens it, not after, or the response can complete
    // before `waitForResponse` starts listening.
    const mintResponse = page.waitForResponse('**/api/share/token');
    await page.getByTestId('share-receipt-button').click();
    const shareSheet = page.getByTestId('share-sheet');
    await expect(shareSheet).toBeVisible();
    const mint = await mintResponse;
    expect(mint.status()).toBe(200);
    await expect(shareSheet.getByTestId('share-preview-image')).toHaveAttribute(
      'src',
      /\/api\/cards\/receipt\//,
    );
    await shareSheet.getByTestId('share-copy-link').click();
    await expect(shareSheet.getByTestId('share-copy-link')).toContainText('Copied!');
    await shareSheet.getByLabel('Close').click();
    await expect(page.getByTestId('share-sheet')).toHaveCount(0);

    // --- 5. claims their account (§6.3) ------------------------------------------------------
    // 5a. Pre-auth UI wiring, exactly like `claim-flow.spec.ts`: the shared-device ghost
    // confirmation card, then the sign-in options — this half is genuinely drivable by a real
    // browser with no stubbing.
    await page.goto('/claim');
    const entry = page.getByTestId('claim-entry');
    await expect(entry).toHaveAttribute('data-phase', 'confirm-ghost');
    await expect(entry).toContainText(ghostHandle);
    await expect(entry).toContainText('1-day streak');
    await entry.getByRole('button', { name: "That's me — continue" }).click();
    await expect(entry).toHaveAttribute('data-phase', 'signin');
    await expect(entry.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
    await expect(entry.getByLabel('Continue with email')).toBeVisible();

    // 5b. Bridge the unautomatable OAuth/email hop (header comment #3), then let the REAL
    // `POST /api/v1/claim` complete the case-A ghost→claimed transition.
    const { sessionToken } = await seedClaimSession();
    // `url` (rather than `domain`+`path`) makes Chromium's CDP `Storage.setCookies` reject a
    // `__Secure-` prefixed cookie outright ("Invalid cookie fields") even on `http://localhost`
    // — verified empirically; `domain`+`path` is the combination that actually round-trips.
    await page.context().addCookies([
      {
        name: SESSION_COOKIE_NAME,
        value: sessionToken,
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
      },
    ]);
    await page.goto('/claim');

    const completion = page.getByTestId('claim-completion');
    await expect(completion).toBeVisible();
    // Fresh user, `age_attested_at IS NULL` (INV-9) → the claim's first attempt 422s
    // AGE_ATTESTATION_REQUIRED and the UI shows the re-affirm step before retrying.
    await expect(completion).toHaveAttribute('data-phase', 'age-attest', { timeout: 10_000 });
    await completion.getByRole('checkbox').check();
    await completion.getByRole('button', { name: 'Confirm & claim' }).click();
    await expect(completion).toHaveAttribute('data-phase', 'done');
    await expect(completion).toHaveAttribute('data-case', 'A');
    await expect(completion).toContainText(ghostHandle);
    await expect(completion).toContainText('1-day streak');

    // --- 6. views their public profile page — same slug (DD-4: same row, not a migration) ---
    await page.goto(`/p/${profileSlug}`);
    await expect(page.locator('h1')).toContainText(ghostHandle);
    await expect(page.getByText('Streak', { exact: true })).toBeVisible();
    // `dd` template is `{currentStreak} (best {bestStreak})` (`app/p/[slug]/page.tsx`) — distinctive
    // enough not to false-positive on unrelated "1"s elsewhere on the page.
    await expect(page.locator('main')).toContainText('(best 1)');
    await expect(page.locator('main')).toContainText(question.headline as string);
    await expect(page.locator('main')).toContainText('WIN');
  });

  test('home page renders the daily-question surface (§10.1) without depending on seeded state', async ({
    page,
  }) => {
    // Deliberately decoupled from the main test's seeded question (header comment #1: only one
    // real "today" `kind='daily'` row can exist globally, so this can't assert on specific
    // content without racing every other worker/spec/retry for that single row) — this just
    // proves `/` renders the state-machine UI or the documented empty state, never a 500.
    const res = await page.goto('/');
    expect(res?.status()).toBe(200);
    await expect(page.locator('h1')).toContainText(PRODUCT_NAME);
    // Either a real "today" daily is showing (some state) or the documented empty state —
    // never neither (that would mean the server component threw and rendered nothing usable).
    const anyState = page.locator(
      [
        'question-open',
        'question-locked',
        'question-revealed',
        'question-scheduled',
        'question-voided',
        'no-question-today',
      ]
        .map((id) => `[data-testid="${id}"]`)
        .join(', '),
    );
    await expect(anyState.first()).toBeVisible();
  });
});
