/**
 * WS23-T1 · Journey 3 (docs/journeys-plan.md §5): a ghost WITH a streak sees the ambient Save chip
 * (WS21-T2 D-J8) → saves (the real ghost→claimed case-A claim, §6.3/§6.4, DD-4) → their record is
 * intact on the same public profile → the nemesis they were already assigned surfaces on `/rivals`.
 *
 * Save-value is seeded directly on the profile (`currentStreak`/`bestStreak` columns — `hasSaveValue`
 * fires for a ghost with `currentStreak >= 1`, `lib/save-status.ts`), which is also the value the
 * pre-auth claim card and the SaveChip both read from `GET /api/v1/me`. The claim's unautomatable
 * OAuth/email hop is bridged with a directly-seeded Auth.js "database" session exactly like
 * `golden-loop.spec.ts` step 5. The nemesis pairing is a real `nemesis_pairings` row on the SAME
 * profile id (DD-4: claiming is a kind flip, not a row migration), so the assignment the profile
 * already had is exactly what `/rivals` shows once it's claimed.
 *
 * Wide-season find-or-create is serialized with `pg_advisory_xact_lock` (verbatim from
 * `nemesis-page-states.spec.ts`) so `fullyParallel` workers never race a duplicate
 * `(kind, starts_on, ends_on)` season row.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { and, eq, sql } from 'drizzle-orm';
import { etDateString, isoWeekMonday, now } from '@receipts/core';
import { nemesisPairings, profiles, seasons } from '@receipts/db';
import { buildNemesisPairing, buildProfile, buildSeason } from '@receipts/db/testing';
import {
  addGhostCookie,
  connectDb,
  seedClaimSession,
  seedGhost,
  SESSION_COOKIE_NAME,
  type DbHandle,
} from './_journey-helpers';

let handle: DbHandle;

test.beforeAll(() => {
  handle = connectDb();
});

test.afterAll(async () => {
  await handle.pool.end();
});

const WIDE_SEASON_STARTS_ON = '2020-01-01';
const WIDE_SEASON_ENDS_ON = '2035-12-31';
const WIDE_SEASON_LOCK_KEY = 727_002_026; // same key as nemesis-page-states.spec.ts

async function seedWideSeason(): Promise<string> {
  const { db } = handle;
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

test.describe('Journey 3 · save chip → save → record intact → nemesis on /rivals', () => {
  test('ghost with a streak saves, keeps its record, and sees its assigned nemesis on /rivals', async ({
    page,
    context,
  }) => {
    test.setTimeout(60_000);
    const unique = randomUUID();

    // A ghost with a real 3-day streak — value to lose.
    const ghost = await seedGhost(handle.db, {
      handle: `Journey Saver ${unique}`,
      slug: `journey-saver-${unique}`,
      currentStreak: 3,
      bestStreak: 3,
    });

    // The nemesis they're already assigned this week (on the SAME profile id).
    const seasonId = await seedWideSeason();
    const [opponent] = await handle.db
      .insert(profiles)
      .values(buildProfile({ kind: 'claimed', status: 'active', handle: `Journey Rival ${unique}` }))
      .returning();
    const opponentId = opponent!.id as string;
    const [a, b] = ghost.profileId < opponentId ? [ghost.profileId, opponentId] : [opponentId, ghost.profileId];
    const weekStart = isoWeekMonday(etDateString(now()));
    await handle.db
      .insert(nemesisPairings)
      .values(buildNemesisPairing(seasonId, a, b, { weekStart, status: 'active', winnerProfileId: null }));

    // --- 1. the Save chip appears for the ghost (value to lose) --------------------------------
    await addGhostCookie(context, ghost.profileId, ghost.secret);
    await page.goto('/you');
    const chip = page.getByTestId('save-chip');
    await expect(chip).toBeVisible();
    await expect(chip).toHaveAttribute('href', /\/claim\?next=/);

    // --- 2. saves: the real pre-auth ghost card, then the case-A claim completion --------------
    await chip.click();
    const entry = page.getByTestId('claim-entry');
    await expect(entry).toHaveAttribute('data-phase', 'confirm-ghost');
    await expect(entry).toContainText(ghost.handle);
    await expect(entry).toContainText('3-day streak');
    await entry.getByRole('button', { name: "That's me — continue" }).click();
    await expect(entry).toHaveAttribute('data-phase', 'signin');

    const { sessionToken } = await seedClaimSession(handle.db);
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
    await page.goto('/claim');
    const completion = page.getByTestId('claim-completion');
    await expect(completion).toBeVisible();
    await expect(completion).toHaveAttribute('data-phase', 'age-attest', { timeout: 10_000 });
    await completion.getByRole('checkbox').check();
    await completion.getByRole('button', { name: 'Confirm & save' }).click();
    await expect(completion).toHaveAttribute('data-phase', 'done');
    await expect(completion).toHaveAttribute('data-case', 'A');

    // --- 3. record intact: same public profile still shows the streak (DD-4) -------------------
    await page.goto(`/p/${ghost.slug}`);
    await expect(page.locator('h1')).toContainText(ghost.handle);
    await expect(page.locator('main')).toContainText('(best 3)');

    // --- 4. the assigned nemesis surfaces on /rivals (now that they're claimed) ----------------
    await page.goto('/rivals');
    await expect(page.getByTestId('nemesis-assignment-state')).toBeVisible();
    await expect(page.getByTestId('nemesis-assignment-card')).toContainText(opponent!.handle as string);
  });
});
