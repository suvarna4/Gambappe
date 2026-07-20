/**
 * Structural redesign of the nemesis section (design-diff audit): `/nemesis` used to stack a
 * compact `NemesisAssignmentCard`, the FULL `NemesisMatchupCard` (duplicating `/vs/[pairingId]`),
 * and the entire history list on one continuous page. It's now a state machine
 * (`selectNemesisPageState`, `lib/nemesis/page-state.ts`) rendering exactly ONE of
 * assignment/verdict/empty as primary content, and the full matchup moved to a new private
 * `/nemesis/matchup` route. This suite covers the three real-Postgres cases the redesign itself
 * asked for:
 *   (a) the assignment state shows the redesigned `NemesisAssignmentCard` and links to
 *       `/nemesis/matchup`;
 *   (b) `/nemesis/matchup` renders the matchup card with real "You" labeling for an authenticated
 *       participant, and redirects to `/nemesis` for a viewer with no active pairing;
 *   (c) the verdict state promotes the most recent settled week and it is NOT duplicated in the
 *       history list below.
 *
 * Session-seeding, wide-season, and advisory-lock helpers are copied verbatim from
 * `nemesis-rematch.spec.ts`'s header-documented pattern (same rationale: a real Auth.js
 * "database"-strategy session on an already-`claimed` profile, and a find-or-create wide season
 * serialized with `pg_advisory_xact_lock` so `fullyParallel` workers never race a duplicate
 * `(kind, starts_on, ends_on)` row) — see that file for the full justification of each.
 */
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { and, eq, sql } from 'drizzle-orm';
import {
  connect,
  nemesisPairings,
  profiles,
  seasons,
  sessions,
  users,
  type Db,
} from '@receipts/db';
import { buildNemesisPairing, buildProfile, buildSeason } from '@receipts/db/testing';
import type pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts';

/**
 * A Monday `week_start` (`YYYY-MM-DD`) whose `nemesis:conclude` instant (that week's Sunday
 * 22:00 ET) is safely in the past but still inside `page-state.ts`'s `VERDICT_FRESH_WINDOW_MS`
 * (8 days) of REAL current time — this suite runs against `next start`'s real wall clock (see
 * the header comment above on why season dates are wide-real-clock-covering, same reasoning
 * applies here), so this can't be a fixed calendar date the way the sibling
 * `nemesis-rematch.spec.ts` suite's `weekStart: '2026-06-01'` fixtures get away with (that
 * suite only exercises `RematchPanel`'s own state machine, which has no freshness concept —
 * this suite's test (c) specifically needs the promoted entry's week to be genuinely fresh
 * relative to whenever the test actually runs). Picks last week's Monday (7-13 days back from
 * "now"), whose conclusion lands 1-7 days ago — comfortably inside the 8-day window with margin
 * on both ends regardless of what day of the week the test executes.
 */
function recentFreshWeekStart(): string {
  // A 12h buffer before snapping to the ISO week Monday. Without it, `now` between roughly
  // 00:00 and 02:00-03:00 UTC on a Monday (i.e. before that week's own Sunday-22:00-ET
  // conclusion instant, ~02:00/03:00 UTC depending on EDT/EST) would snap to THIS week's
  // Monday and produce a not-yet-concluded (future) `nemesisConcludeAt`, failing the
  // `msSinceConcluded >= 0` guard — a real, narrow flake this exact form of the helper hit in
  // review. Verified numerically (not just by hand) across a full year of 30-minute samples,
  // including the EST/EDT transition: a 12h buffer keeps the worst-case margin to either edge
  // of `VERDICT_FRESH_WINDOW_MS` (8 days) at roughly 10 hours, comfortably away from both.
  const now = new Date();
  const buffered = new Date(now.getTime() - 12 * 60 * 60 * 1000);
  const isoDow = buffered.getUTCDay() === 0 ? 7 : buffered.getUTCDay(); // Mon=1..Sun=7
  const daysSinceThisMonday = isoDow - 1;
  const lastWeekMonday = new Date(buffered);
  lastWeekMonday.setUTCDate(buffered.getUTCDate() - daysSinceThisMonday - 7);
  return lastWeekMonday.toISOString().slice(0, 10);
}

// See `nemesis-rematch.spec.ts`'s header comment on this exact constant — `next start` always
// runs with `NODE_ENV=production`, so `useSecureCookies` (`apps/web/auth.ts`) is always true here.
const SESSION_COOKIE_NAME = '__Secure-authjs.session-token';

let pool: pg.Pool;
let db: Db;

test.beforeAll(() => {
  ({ pool, db } = connect({ connectionString: DATABASE_URL }));
});

test.afterAll(async () => {
  await pool.end();
});

const WIDE_SEASON_STARTS_ON = '2020-01-01';
const WIDE_SEASON_ENDS_ON = '2035-12-31';
// Same canonical key as `nemesis-rematch.spec.ts`'s identical helper — see that file for the full
// rationale (find-or-create + advisory lock avoids two suites minting duplicate wide-season rows).
const WIDE_SEASON_LOCK_KEY = 727_002_026;

async function seedWideSeason(): Promise<string> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${WIDE_SEASON_LOCK_KEY})`);
    const [existing] = await tx
      .select()
      .from(seasons)
      .where(
        and(
          eq(seasons.kind, 'nemesis'),
          eq(seasons.startsOn, WIDE_SEASON_STARTS_ON),
          eq(seasons.endsOn, WIDE_SEASON_ENDS_ON),
        ),
      )
      .limit(1);
    if (existing) return existing.id as string;
    const [season] = await tx
      .insert(seasons)
      .values(buildSeason({ startsOn: WIDE_SEASON_STARTS_ON, endsOn: WIDE_SEASON_ENDS_ON }))
      .returning();
    return season!.id as string;
  });
}

async function seedClaimedProfileWithSession(handle: string): Promise<{ profileId: string; sessionToken: string }> {
  const userId = randomUUID();
  const email = `nemesis-page-states-${randomUUID()}@example.test`;
  await db.insert(users).values({ id: userId, email, ageAttestedAt: new Date() });

  const [profile] = await db
    .insert(profiles)
    .values(buildProfile({ kind: 'claimed', status: 'active', userId, handle }))
    .returning();

  const sessionToken = randomUUID();
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await db.insert(sessions).values({ sessionToken, userId, expires });

  return { profileId: profile!.id as string, sessionToken };
}

async function addSessionCookie(page: Page, sessionToken: string): Promise<void> {
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
}

test.describe('/nemesis page-state redesign (real Postgres + HTTP)', () => {
  test('(a) the assignment state shows the redesigned card and links to /nemesis/matchup', async ({ page }) => {
    const unique = randomUUID();
    const seasonId = await seedWideSeason();
    const { profileId: viewerId, sessionToken } = await seedClaimedProfileWithSession(
      `E2E Assignment Viewer ${unique}`,
    );
    const [opponent] = await db
      .insert(profiles)
      .values(buildProfile({ kind: 'claimed', status: 'active', handle: `E2E Assignment Opponent ${unique}` }))
      .returning();
    const opponentId = opponent!.id as string;
    const [a, b] = viewerId < opponentId ? [viewerId, opponentId] : [opponentId, viewerId];

    await db
      .insert(nemesisPairings)
      .values(buildNemesisPairing(seasonId, a, b, { weekStart: '2026-07-13', status: 'active' }));

    await addSessionCookie(page, sessionToken);
    await page.goto('/nemesis');

    await expect(page.getByTestId('nemesis-assignment-state')).toBeVisible();
    await expect(page.getByTestId('nemesis-assignment-card')).toBeVisible();
    await expect(page.getByTestId('nemesis-assignment-card')).toContainText(opponent!.handle as string);
    // The literal "VS" badge (no score yet — assignment day is before any picks land), not the
    // full matchup card, which now lives on its own private route.
    await expect(page.getByTestId('nemesis-assignment-card')).toContainText('VS');

    // The other two states never render alongside this one.
    await expect(page.getByTestId('nemesis-verdict-state')).toHaveCount(0);
    await expect(page.getByTestId('nemesis-empty-state')).toHaveCount(0);

    const matchupLink = page.getByRole('link', { name: 'View matchup' });
    await expect(matchupLink).toBeVisible();
    await expect(matchupLink).toHaveAttribute('href', '/nemesis/matchup');
  });

  test('(b1) /nemesis/matchup renders the matchup card with real "You" labeling for an authenticated participant', async ({
    page,
  }) => {
    const unique = randomUUID();
    const seasonId = await seedWideSeason();
    const { profileId: viewerId, sessionToken } = await seedClaimedProfileWithSession(
      `E2E Matchup Viewer ${unique}`,
    );
    const [opponent] = await db
      .insert(profiles)
      .values(buildProfile({ kind: 'claimed', status: 'active', handle: `E2E Matchup Opponent ${unique}` }))
      .returning();
    const opponentId = opponent!.id as string;
    const [a, b] = viewerId < opponentId ? [viewerId, opponentId] : [opponentId, viewerId];

    await db
      .insert(nemesisPairings)
      .values(buildNemesisPairing(seasonId, a, b, { weekStart: '2026-07-13', status: 'active' }));

    await addSessionCookie(page, sessionToken);
    await page.goto('/nemesis/matchup');

    // `/vs/[pairingId]` is deliberately viewer-free (INV-10) and never renders "You" — this
    // private route is the whole reason it exists: real identity threaded through. Scoped to
    // `NemesisMatchupCard`'s own `SideBlock` label specifically (`text-ink font-medium`) — a
    // bare `getByText('You')` also matches `NemesisScoreboard`'s unrelated "You" column header.
    await expect(page.locator('span.text-ink.font-medium', { hasText: 'You' })).toBeVisible();
    await expect(page.getByText(opponent!.handle as string)).toBeVisible();
  });

  test('(b2) /nemesis/matchup redirects to /nemesis for a viewer with no active pairing', async ({ page }) => {
    const unique = randomUUID();
    const { sessionToken } = await seedClaimedProfileWithSession(`E2E No-Pairing Viewer ${unique}`);

    await addSessionCookie(page, sessionToken);
    await page.goto('/nemesis/matchup');

    await expect(page).toHaveURL(/\/nemesis$/);
  });

  test('(c) the verdict state promotes the most recent settled week and it is not duplicated in the history list below', async ({
    page,
  }) => {
    const unique = randomUUID();
    const seasonId = await seedWideSeason();
    const { profileId: viewerId, sessionToken } = await seedClaimedProfileWithSession(
      `E2E Verdict Viewer ${unique}`,
    );
    const [olderOpponent, newerOpponent] = await Promise.all([
      db
        .insert(profiles)
        .values(buildProfile({ kind: 'claimed', status: 'active', handle: `E2E Older Opponent ${unique}` }))
        .returning()
        .then((r) => r[0]!),
      db
        .insert(profiles)
        .values(buildProfile({ kind: 'claimed', status: 'active', handle: `E2E Newer Opponent ${unique}` }))
        .returning()
        .then((r) => r[0]!),
    ]);
    const olderOpponentId = olderOpponent.id as string;
    const newerOpponentId = newerOpponent.id as string;
    const [olderA, olderB] = viewerId < olderOpponentId ? [viewerId, olderOpponentId] : [olderOpponentId, viewerId];
    const [newerA, newerB] = viewerId < newerOpponentId ? [viewerId, newerOpponentId] : [newerOpponentId, viewerId];

    // Two settled (completed, non-cancelled) weeks, no active pairing — only the NEWER one
    // (later `week_start`, and the one actually inside its `VERDICT_FRESH_WINDOW_MS`) should be
    // promoted to the verdict state. The older entry's exact date doesn't matter — it's only
    // ever rendered via the plain `NemesisHistoryList` row below, which has no freshness concept
    // — but the newer one MUST be real-wall-clock-recent, hence `recentFreshWeekStart()`.
    await db
      .insert(nemesisPairings)
      .values(buildNemesisPairing(seasonId, olderA, olderB, { weekStart: '2026-06-01' }));
    await db
      .insert(nemesisPairings)
      .values(buildNemesisPairing(seasonId, newerA, newerB, { weekStart: recentFreshWeekStart() }));

    await addSessionCookie(page, sessionToken);
    await page.goto('/nemesis');

    await expect(page.getByTestId('nemesis-assignment-state')).toHaveCount(0);
    await expect(page.getByTestId('nemesis-empty-state')).toHaveCount(0);

    const verdictState = page.getByTestId('nemesis-verdict-state');
    await expect(verdictState).toBeVisible();
    await expect(verdictState).toContainText(newerOpponent.handle as string);

    const historySection = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'History', level: 2 }) });
    await expect(historySection).toBeVisible();
    // The promoted (newer) entry must NOT also appear as a row in the aggregate history list...
    await expect(historySection.getByRole('link', { name: newerOpponent.handle as string })).toHaveCount(0);
    // ...while the non-promoted (older) entry still does, unchanged.
    await expect(historySection.getByRole('link', { name: olderOpponent.handle as string })).toBeVisible();
  });
});
