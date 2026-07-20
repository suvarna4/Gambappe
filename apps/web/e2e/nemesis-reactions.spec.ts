/**
 * SW10-T4 (wiring-gaps doc §4 SW10-T4): the reaction-stamps round-trip through REAL HTTP against
 * real Postgres — `ReactionStampsPanel`'s entire client-derived flow (self-fetch `/me`, match the
 * viewer against the pairing's own `a`/`b` participant ids, POST, and reflect the result after a
 * real navigation) had no coverage beyond payload-level integration tests and a
 * renders-nothing-server-side proof (fable review of PR #91, finding 3 — this repo has no
 * DOM-interaction unit-testing library, so gesture/stateful client behavior is e2e-only, same
 * posture as `swipe-ballot.spec.ts`/`nemesis-rematch.spec.ts`).
 *
 * AC (wiring-gaps doc §4 SW10-T4): "the viewer's own current stamp round-trips (post → reload →
 * `selected` reflects it, assert on `/nemesis` or via the client-derived path, NOT on
 * `/vs/[pairingId]`'s ISR render, which may serve a ≤30s-stale snapshot by design)" — this file
 * asserts exactly that, on `/nemesis`, across a real page reload (not just in-session state).
 *
 * `/nemesis` is SSR-gated (`auth()` + redirect to `/claim`), so this seeds a real Auth.js session
 * onto an already-`claimed` profile the same way `nemesis-rematch.spec.ts`'s header comment
 * justifies — see that file for the full rationale on both the session-seeding approach and the
 * wide-season/advisory-lock pattern reused verbatim below (this file's own pairing doesn't need a
 * SPECIFIC season window since `getCurrentPairingForProfile` only filters on `status='active'`,
 * but seeding through the same canonical row avoids minting yet another wide-season duplicate in
 * this suite's shared local Postgres).
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { and, eq, sql } from 'drizzle-orm';
import {
  connect,
  nemesisPairings,
  pairingReactions,
  profiles,
  seasons,
  sessions,
  users,
  type Db,
} from '@receipts/db';
import { buildNemesisPairing, buildProfile, buildSeason } from '@receipts/db/testing';
import type pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts';

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
const WIDE_SEASON_LOCK_KEY = 727_002_026; // same canonical key as nemesis-rematch.spec.ts's identical helper — see that file for the full rationale.

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
  const email = `nemesis-reactions-${randomUUID()}@example.test`;
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

test.describe('/nemesis reaction stamps (§9.2 POST /reactions pairing branch, real Postgres + HTTP)', () => {
  test("a claimed participant's stamp round-trips through a real page reload — the client-derived path finding 3 (fable review of PR #91) flagged as untested", async ({
    page,
    context,
  }) => {
    const unique = randomUUID();
    const seasonId = await seedWideSeason();
    const { profileId: viewerId, sessionToken } = await seedClaimedProfileWithSession(`E2E Reactor ${unique}`);
    const [opponent] = await db
      .insert(profiles)
      .values(buildProfile({ kind: 'claimed', status: 'active', handle: `E2E Opponent ${unique}` }))
      .returning();
    const opponentId = opponent!.id as string;
    const [a, b] = viewerId < opponentId ? [viewerId, opponentId] : [opponentId, viewerId];

    // An ACTIVE pairing this week — `getCurrentPairingForProfile` (behind `/nemesis`) only
    // filters `status='active'`, no date scoping.
    const [pairing] = await db
      .insert(nemesisPairings)
      .values(buildNemesisPairing(seasonId, a, b, { weekStart: '2020-01-06', status: 'active' }))
      .returning();

    await context.addCookies([
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

    await page.goto('/nemesis');
    const panel = page.getByTestId('reaction-stamps-panel');
    await expect(panel).toBeVisible();

    // Scoped to the interactive panel specifically — a successful post triggers
    // `router.refresh()` (fable review of PR #91, finding 2), which re-renders
    // `NemesisMatchupCard`'s server-provided `SideBlock` read-only badge for the viewer's own
    // side too, and that badge shares the same `reaction-{stamp}` testid convention.
    const luckyButton = panel.getByTestId('reaction-Lucky');
    await expect(luckyButton).toHaveAttribute('aria-pressed', 'false');
    // `handleSelect` flips `aria-pressed` optimistically BEFORE the POST resolves — wait for the
    // real network round-trip, not just the optimistic UI, before asserting DB state.
    await Promise.all([
      page.waitForResponse((res) => res.url().includes('/api/v1/reactions') && res.request().method() === 'POST'),
      luckyButton.click(),
    ]);
    await expect(luckyButton).toHaveAttribute('aria-pressed', 'true');

    // The real, persisted effect — not just the panel's own optimistic render.
    const [row] = await db.select().from(pairingReactions).where(eq(pairingReactions.profileId, viewerId));
    expect(row?.pairingId).toBe(pairing!.id);
    expect(row?.emoji).toBe('Lucky');

    // A REAL navigation (not a client-side re-render) — this is what finding 3 flagged as
    // unproven: `ReactionStampsPanel` re-mounts from scratch, re-fetches `/me`, re-matches the
    // viewer against the pairing's participant ids, and must independently arrive at the same
    // `selected` stamp purely from server data, with no leftover client state to lean on.
    await page.reload();
    await expect(panel).toBeVisible();
    await expect(panel.getByTestId('reaction-Lucky')).toHaveAttribute('aria-pressed', 'true');
  });

  test('a same-day repost replaces the stamp rather than adding a second row', async ({ page, context }) => {
    const unique = randomUUID();
    const seasonId = await seedWideSeason();
    const { profileId: viewerId, sessionToken } = await seedClaimedProfileWithSession(`E2E Replacer ${unique}`);
    const [opponent] = await db
      .insert(profiles)
      .values(buildProfile({ kind: 'claimed', status: 'active', handle: `E2E Replaced-Opponent ${unique}` }))
      .returning();
    const opponentId = opponent!.id as string;
    const [a, b] = viewerId < opponentId ? [viewerId, opponentId] : [opponentId, viewerId];
    await db.insert(nemesisPairings).values(buildNemesisPairing(seasonId, a, b, { weekStart: '2020-01-06', status: 'active' }));

    await context.addCookies([
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

    await page.goto('/nemesis');
    const panel = page.getByTestId('reaction-stamps-panel');
    await expect(panel).toBeVisible();

    const postResponse = () =>
      page.waitForResponse((res) => res.url().includes('/api/v1/reactions') && res.request().method() === 'POST');

    await Promise.all([postResponse(), panel.getByTestId('reaction-Sweating?').click()]);
    await expect(panel.getByTestId('reaction-Sweating?')).toHaveAttribute('aria-pressed', 'true');

    await Promise.all([postResponse(), panel.getByTestId('reaction-Respect').click()]);
    await expect(panel.getByTestId('reaction-Respect')).toHaveAttribute('aria-pressed', 'true');
    await expect(panel.getByTestId('reaction-Sweating?')).toHaveAttribute('aria-pressed', 'false');

    const rows = await db.select().from(pairingReactions).where(eq(pairingReactions.profileId, viewerId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.emoji).toBe('Respect');
  });
});
