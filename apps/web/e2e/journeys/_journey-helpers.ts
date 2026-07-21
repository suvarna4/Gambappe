/**
 * WS23-T1 · Shared seeding + identity helpers for the Journey E2E gate (docs/journeys-plan.md §5).
 *
 * These journey specs run in a DEDICATED Playwright project (`journeys`) whose webServer is booted
 * with the full journeys flag set ON — `swipe_ballot`, `topic_markets`, `callouts` (plus the
 * already-global `nemesis`/`duo_queue`), `departures_board` deliberately OFF — see
 * `playwright.config.ts`. That server runs on its OWN port (3001) so flipping `swipe_ballot`/
 * `topic_markets` on (which changes what `/` and an OPEN `/q/[slug]` render) never disturbs the
 * flag-off lane the rest of the suite relies on (golden-loop's tap-button flow, question-page's
 * open state, the INV-10 byte-identical regressions). Same shared `receipts` Postgres as every
 * other spec, so EVERYTHING seeded here obeys the house rules `golden-loop.spec.ts` /
 * `crowd.spec.ts` document:
 *   - never a second `kind='daily'` row at a date another daily already holds (the
 *     `questions_daily_date_uq` partial unique index) — dailies are seeded at randomized
 *     far-future (2100+) `question_date`s, or as `kind='topic'` rows (no date uniqueness at all);
 *   - a `status:'revealed'` daily is ALWAYS well-formed (`revealedAt`/`settledAt`/`outcome`/lock
 *     snapshots) so `serialize-question.ts` can never 500 `/` or `/api/v1/stack`;
 *   - resolution/settlement is driven through the real repositories/engine (`lockQuestionTx` etc.),
 *     never hand-rolled SQL.
 *
 * Every unique-ish default is forced to a fresh UUID per call to stay collision-free under
 * `fullyParallel: true` + CI retries against the one persistent DB (see `question-page.spec.ts`'s
 * `seedQuestion` header for the shared hazard).
 */
import { randomUUID } from 'node:crypto';
import { type BrowserContext, type Page } from '@playwright/test';
import { and, eq, inArray, lt } from 'drizzle-orm';
import {
  connect,
  markets,
  picks,
  profiles,
  questions,
  sessions,
  users,
  type Db,
} from '@receipts/db';
import { buildMarket, buildPick, buildProfile, buildQuestion } from '@receipts/db/testing';
import type pg from 'pg';
import {
  buildGhostCookieValue,
  generateGhostSecret,
  GHOST_COOKIE_NAME,
  hashGhostSecret,
} from '@/lib/ghost-cookie';

export const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts';
export const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

/** `next start` always runs with NODE_ENV=production → `useSecureCookies` (auth.ts) is always true,
 * so the Auth.js session cookie is the `__Secure-` prefixed name (see `golden-loop.spec.ts`). */
export const SESSION_COOKIE_NAME = '__Secure-authjs.session-token';

export interface DbHandle {
  pool: pg.Pool;
  db: Db;
}

export function connectDb(): DbHandle {
  const { pool, db } = connect({ connectionString: DATABASE_URL });
  return { pool, db };
}

/** A synthetic, collision-free `question_date` far outside real "today" and every other
 * fixture/factory range — mirrors `golden-loop.spec.ts` / `obituary-wake.spec.ts`. */
export function randomFutureQuestionDate(): string {
  const year = 2100 + Math.floor(Math.random() * 400);
  const month = String(1 + Math.floor(Math.random() * 12)).padStart(2, '0');
  const day = String(1 + Math.floor(Math.random() * 28)).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export interface SeededGhost {
  profileId: string;
  secret: string;
  handle: string;
  slug: string;
}

export async function seedGhost(
  db: Db,
  overrides: Partial<Parameters<typeof buildProfile>[0]> = {},
): Promise<SeededGhost> {
  const unique = randomUUID();
  const secret = generateGhostSecret();
  const profile = buildProfile({
    handle: `Journey ${unique}`,
    slug: `journey-${unique}`,
    ghostSecretHash: hashGhostSecret(secret),
    ...overrides,
  });
  await db.insert(profiles).values(profile);
  return {
    profileId: profile.id as string,
    secret,
    handle: profile.handle as string,
    slug: profile.slug as string,
  };
}

export async function addGhostCookie(
  ctx: BrowserContext,
  profileId: string,
  secret: string,
): Promise<void> {
  await ctx.addCookies([
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
}

export interface SeededClaimed {
  profileId: string;
  slug: string;
  handle: string;
  sessionToken: string;
  userId: string;
}

/** A real Auth.js "database"-strategy session on an already-`claimed` profile — the exact shape
 * `rivals-hub.spec.ts` / `nemesis-page-states.spec.ts` use. */
export async function seedClaimedProfileWithSession(
  db: Db,
  overrides: Partial<Parameters<typeof buildProfile>[0]> = {},
): Promise<SeededClaimed> {
  const userId = randomUUID();
  const email = `journey-${randomUUID()}@example.test`;
  await db.insert(users).values({ id: userId, email, ageAttestedAt: new Date() });
  const [profile] = await db
    .insert(profiles)
    .values(
      buildProfile({
        kind: 'claimed',
        status: 'active',
        userId,
        handle: `Journey Claimed ${randomUUID()}`,
        ...overrides,
      }),
    )
    .returning();
  const sessionToken = randomUUID();
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await db.insert(sessions).values({ sessionToken, userId, expires });
  return {
    profileId: profile!.id as string,
    slug: profile!.slug as string,
    handle: profile!.handle as string,
    sessionToken,
    userId,
  };
}

/** A real Auth.js session with a fresh, `age_attested_at IS NULL` user — the shape the claim route
 * completes a ghost→claimed case-A transition against (see `golden-loop.spec.ts` step 5). */
export async function seedClaimSession(db: Db): Promise<{ sessionToken: string; email: string }> {
  const userId = randomUUID();
  const email = `journey-claim-${randomUUID()}@example.test`;
  await db.insert(users).values({ id: userId, email, ageAttestedAt: null });
  const sessionToken = randomUUID();
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await db.insert(sessions).values({ sessionToken, userId, expires });
  return { sessionToken, email };
}

export async function addSessionCookie(ctx: BrowserContext, sessionToken: string): Promise<void> {
  await ctx.addCookies([
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
}

/** Seed one OPEN `kind='topic'` card (no daily-date uniqueness) that `assembleStackFeed` /
 * `listOpenTopicQuestions` deal into the mixed stack. Returns the question slug + headline. */
export async function seedTopicCard(
  db: Db,
  headline: string,
  opts: { yesLabel?: string; noLabel?: string } = {},
): Promise<{ slug: string; headline: string; questionId: string }> {
  const unique = randomUUID();
  const market = buildMarket({
    venueMarketId: `KX-JOURNEY-TOPIC-${unique}`,
    category: 'economics',
    status: 'open',
    closeTime: new Date(Date.now() + 30 * 24 * 3600_000),
    yesPrice: 0.6,
  });
  await db.insert(markets).values(market);
  const question = buildQuestion(market.id as string, {
    kind: 'topic',
    questionDate: null,
    slug: `journey-topic-${unique}`,
    status: 'open',
    headline,
    yesLabel: opts.yesLabel ?? 'Yes',
    noLabel: opts.noLabel ?? 'No',
    // FAR-future lock so the card stays throwable (effective-state `open`) for the whole suite,
    // never decaying into an un-throwable locked card that would stall the deck drain.
    openAt: new Date(Date.now() - 3600_000),
    lockAt: new Date(Date.now() + 365 * 24 * 3600_000),
    revealAt: new Date(Date.now() + 366 * 24 * 3600_000),
  });
  await db.insert(questions).values(question);
  return { slug: question.slug as string, headline, questionId: question.id as string };
}

/**
 * The `/` deck is viewer-FREE (INV-10) so it always deals EVERY open `kind='topic'` card in the
 * shared DB (capped 8, `assembleStackFeed`) — including stale ones left by earlier runs whose
 * `lock_at` is now in the past, which render as un-throwable LOCKED cards and would stall a
 * drain-to-`deck-cleared`. This deletes only those already-expired topic cards (and their picks) —
 * dead data no live/parallel test relies on (fresh seeds always carry a future `lock_at`) — so the
 * deck deals only throwable cards. Idempotent; safe under `fullyParallel`.
 */
export async function pruneExpiredTopics(db: Db): Promise<void> {
  const expired = await db
    .select({ id: questions.id })
    .from(questions)
    .where(
      and(eq(questions.kind, 'topic'), eq(questions.status, 'open'), lt(questions.lockAt, new Date())),
    );
  if (expired.length === 0) return;
  const ids = expired.map((r) => r.id as string);
  await db.delete(picks).where(inArray(picks.questionId, ids));
  await db.delete(questions).where(inArray(questions.id, ids));
}

/** Seed a market + question + a pending pick for `profileId` — a `/sweat` "position". */
export async function seedPendingPosition(
  db: Db,
  profileId: string,
  opts: { headline: string; side?: 'yes' | 'no' } = { headline: 'Journey position' },
): Promise<{ questionId: string; slug: string }> {
  const unique = randomUUID();
  const market = buildMarket({
    venueMarketId: `KX-JOURNEY-POS-${unique}`,
    status: 'open',
    closeTime: new Date(Date.now() + 3 * 24 * 3600_000),
    yesPrice: 0.63,
  });
  await db.insert(markets).values(market);
  const question = buildQuestion(market.id as string, {
    slug: `journey-pos-${unique}`,
    questionDate: null,
    status: 'locked',
    headline: opts.headline,
  });
  await db.insert(questions).values(question);
  await db.insert(picks).values(
    buildPick(question.id as string, profileId, {
      side: opts.side ?? 'yes',
      yesPriceAtEntry: 0.6,
      result: 'pending',
    }),
  );
  return { questionId: question.id as string, slug: question.slug as string };
}

/** Revalidate the ISR cache for `path` via the real worker→web hook (§9.2) — required between a
 * DB-side state transition and the next `page.goto` of the same already-visited slug. */
export async function revalidate(baseURL: string, path: string): Promise<void> {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) throw new Error('INTERNAL_API_SECRET is not set (see playwright.config.ts)');
  const res = await fetch(`${baseURL}/api/v1/internal/revalidate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
    body: JSON.stringify({ paths: [path] }),
  });
  if (res.status !== 200) throw new Error(`revalidate ${path} → ${res.status}`);
}

/** Drain the mixed stack on `/`: throw whatever open card is on stage (a well tap = a real,
 * price-stamped pick), skip anything that isn't throwable, bounded so a stuck state fails instead
 * of hanging. Mirrors `stack-deck.spec.ts`'s own drain loop. Returns the number of throws made. */
export async function drainDeck(page: Page, maxSteps = 16): Promise<number> {
  let throws = 0;
  for (let i = 0; i < maxSteps; i += 1) {
    if (await page.getByTestId('deck-cleared').isVisible().catch(() => false)) break;
    // A pending age gate would block the first throw — confirm it if present.
    const ageConfirm = page.getByTestId('age-gate-confirm');
    if (await ageConfirm.isVisible().catch(() => false)) {
      await ageConfirm.click().catch(() => {});
    }
    const yesWell = page.getByTestId('pick-yes').first();
    if (await yesWell.isVisible().catch(() => false)) {
      await yesWell.click().catch(() => {});
      throws += 1;
    } else {
      await page
        .getByTestId('pick-yes')
        .first()
        .focus()
        .catch(() => {});
      await page.keyboard.press('ArrowUp').catch(() => {});
    }
    await page.waitForTimeout(400);
  }
  return throws;
}
