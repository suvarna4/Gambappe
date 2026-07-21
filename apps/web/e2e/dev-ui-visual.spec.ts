import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * SW10-T5 · Visual regression gate for the `/dev/ui` gallery (wiring-gaps doc §4, closing
 * SW8-T2's un-met AC: "Playwright screenshot snapshots of the gallery page" that "gate CI").
 * `e2e/dev-ui.spec.ts` only makes content assertions (`toContainText`/`toBeVisible`); this is a
 * SEPARATE sibling file rather than additions to that one, for three reasons: (1) screenshot
 * assertions have a fundamentally different failure/triage story than content assertions — a
 * failure here means "run `--update-snapshots` and eyeball the diff", not "read the stack
 * trace", so keeping them in one file makes `playwright test e2e/dev-ui-visual.spec.ts` (or
 * `--update-snapshots` scoped to just this file) a clean, focused re-run without touching the
 * smoke suite; (2) this file needs its own per-test setup (drag/commit sequences to reach the
 * rest/drag/armed/receipt states, masks for time-dependent regions) that would otherwise bloat
 * the smoke test's simple linear structure; (3) `dev-ui.spec.ts` stays fast (one page load, pure
 * assertions) — screenshot capture + comparison is meaningfully slower per test, and CI can
 * shard/parallelize them independently if that's ever needed.
 *
 * Every tile the gallery page (`app/dev/ui/page.tsx`) renders gets a snapshot, including
 * SW10-T1–T4's new tiles (NemesisFlip, DuoTandem, VerdictCard, ReactionStamps — already merged
 * to `main` as of this task, per the wiring-gaps doc's `Depends: —`). Two components exist in
 * the repo but are NOT covered here because the gallery page itself never mounts them as their
 * own tile: `PartnerLockedChip` (only reachable via `SwipeBallot`'s optional `partnerLocked`
 * prop, which `SwipeBallotGalleryDemo` never passes) and `VerdictSwipeCard` (only mounted by the
 * real `RematchPanel`, not the gallery). SW10-T5's AC is "every tile the gallery already
 * renders" — if either of those should get its own gallery tile, that's a `page.tsx` gap for
 * whichever task owns it, not a visual-coverage gap for this one.
 *
 * FLAKINESS / TOLERANCE NOTES (design doc's own warning: "Playwright visual snapshots are
 * notoriously flaky across different OS/font-rendering environments"):
 * - `toHaveScreenshot`'s own default (`animations: 'disabled'`) rewinds/cancels CSS transitions
 *   and animations before capture, so the receipt's print-slide-in and the ballot's idle-nudge
 *   sway never need explicit handling here.
 * - Two regions in the gallery render real wall-clock time and would never pixel-match between
 *   baseline-generation time and a later CI run: `CountdownTicker`'s two live countdowns
 *   (`gallery-countdown`) and the receipt's stamped timestamp + ticking undo countdown
 *   (`gallery-swipeballot`'s receipt state). Both are covered with `mask` rather than frozen via
 *   a fake clock — masking is robust to real server/client clock skew (the countdown's target
 *   time is computed by the server at request time, which drifts run-to-run regardless of any
 *   client-side clock the test installs), whereas freezing only the client clock would make the
 *   displayed diff-to-target UNBOUNDED and *more* variable, not less.
 * - `maxDiffPixelRatio`/`threshold` (set in `playwright.config.ts`) give a small tolerance for
 *   sub-pixel antialiasing drift across font-rendering stacks; see that file for the exact
 *   values and reasoning, including the CI-Chromium-parity risk this repo's sandbox couldn't
 *   fully verify (documented in this task's PR description).
 */

/** Drag past `dxRatio` of the card's width and HOLD (no `mouse.up()`) — for capturing the
 * mid-gesture drag/armed states, which only exist while a pointer is actively down. Mirrors
 * `swipe-ballot.spec.ts`/`placement-swipe.spec.ts`'s `dragCard` helper exactly, minus the
 * release, since those specs only ever care about the post-release outcome. */
async function dragHold(page: Page, card: Locator, dxRatio: number): Promise<void> {
  await card.scrollIntoViewIfNeeded();
  const b = await card.boundingBox();
  if (!b) throw new Error('card has no bounding box');
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  const target = cx + b.width * dxRatio;
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(cx + (target - cx) * (i / 12), cy);
  }
}

test.describe('SW10-T5 /dev/ui visual regression', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dev/ui');
  });

  test('display type & gold accent (SW0-T2)', async ({ page }) => {
    await expect(page.getByTestId('gallery-display-type')).toHaveScreenshot('display-type.png');
  });

  test('BallotCard (static, SW1-T1)', async ({ page }) => {
    await expect(page.getByTestId('gallery-ballotcard')).toHaveScreenshot('ballotcard.png');
  });

  test.describe('SwipeBallot (interactive, SW1-T2/T3)', () => {
    test('rest', async ({ page }) => {
      const demo = page.getByTestId('gallery-swipeballot');
      await demo.getByTestId('ballot-card-interactive').waitFor();
      await expect(demo).toHaveScreenshot('swipeballot-rest.png');
    });

    test('drag (below the 36% arm threshold)', async ({ page }) => {
      const demo = page.getByTestId('gallery-swipeballot');
      const card = demo.getByTestId('ballot-card-interactive');
      await card.waitFor();
      await dragHold(page, card, 0.2);
      await expect(card).toHaveAttribute('data-armed', 'false');
      await expect(demo).toHaveScreenshot('swipeballot-drag.png');
    });

    test('armed (past threshold, held pre-release)', async ({ page }) => {
      const demo = page.getByTestId('gallery-swipeballot');
      const card = demo.getByTestId('ballot-card-interactive');
      await card.waitFor();
      await dragHold(page, card, 0.45);
      await expect(card).toHaveAttribute('data-armed', 'true');
      await expect(demo).toHaveScreenshot('swipeballot-armed.png');
    });

    test('receipt', async ({ page }) => {
      const demo = page.getByTestId('gallery-swipeballot');
      // The tap well is the deterministic path to the receipt state (a well click submits
      // immediately, no drag distance/timing to reproduce exactly) — the drag→commit mechanics
      // are already pinned pixel-for-pixel by the `armed` state above and behaviorally by
      // `swipe-ballot.spec.ts`.
      await demo.getByTestId('pick-yes').click();
      const receipt = demo.getByTestId('receipt-slip');
      await expect(receipt).toBeVisible();
      await expect(demo).toHaveScreenshot('swipeballot-receipt.png', {
        mask: [
          // Header-right timestamp span (`pickedAtLabel` — real wall-clock time of the click).
          receipt.locator('div').first().locator('span').nth(1),
          // "Undo · {secondsLeft}s" — ticks every second.
          demo.getByTestId('undo-pick'),
        ],
      });
    });
  });

  test.describe('Placement swipe (SW6-T1)', () => {
    test('rest', async ({ page }) => {
      const demo = page.getByTestId('gallery-placement-swipe');
      await demo.getByTestId('placement-card').waitFor();
      await expect(demo).toHaveScreenshot('placement-swipe-rest.png');
    });

    test('drag (below the 36% arm threshold)', async ({ page }) => {
      const demo = page.getByTestId('gallery-placement-swipe');
      const card = demo.getByTestId('placement-card');
      await card.waitFor();
      await dragHold(page, card, 0.2);
      await expect(demo).toHaveScreenshot('placement-swipe-drag.png');
    });

    test('armed (past threshold, held pre-release)', async ({ page }) => {
      const demo = page.getByTestId('gallery-placement-swipe');
      const card = demo.getByTestId('placement-card');
      await card.waitFor();
      await dragHold(page, card, 0.45);
      await expect(demo).toHaveScreenshot('placement-swipe-armed.png');
    });

    test('called', async ({ page }) => {
      const demo = page.getByTestId('gallery-placement-swipe');
      await demo.getByTestId('placement-pick-yes').click();
      await expect(demo.getByTestId('placement-demo-result')).toHaveText('called: yes');
      await expect(demo).toHaveScreenshot('placement-swipe-called.png');
    });
  });

  test('ObituaryCard (P3, SW4-T1)', async ({ page }) => {
    await expect(page.getByTestId('gallery-obituary')).toHaveScreenshot('obituary.png');
  });

  test('Nemesis flip + Duo tandem (SP2, SW10-T1/T3)', async ({ page }) => {
    await expect(page.getByTestId('gallery-matchup-flips')).toHaveScreenshot('matchup-flips.png');
  });

  test('Verdict card + reaction stamps (SP2, SW10-T2/T4)', async ({ page }) => {
    await expect(page.getByTestId('gallery-verdict')).toHaveScreenshot('verdict.png');
  });

  test('GraveyardShelf (P3, SW4-T3)', async ({ page }) => {
    await expect(page.getByTestId('gallery-graveyard')).toHaveScreenshot('graveyard.png');
  });

  test('TicketCard', async ({ page }) => {
    await expect(page.getByTestId('gallery-ticketcard')).toHaveScreenshot('ticketcard.png');
  });

  test('TicketFrame (WS16-T3, paper + board tones)', async ({ page }) => {
    await expect(page.getByTestId('gallery-ticketframe')).toHaveScreenshot('ticketframe.png');
  });

  test('PunchWell (WS16-T3, unpunched + punched)', async ({ page }) => {
    await expect(page.getByTestId('gallery-punchwell')).toHaveScreenshot('punchwell.png');
  });

  test('TapeLabel (WS16-T3)', async ({ page }) => {
    await expect(page.getByTestId('gallery-tapelabel')).toHaveScreenshot('tapelabel.png');
  });

  test('SameSideRow (WS16-T3)', async ({ page }) => {
    await expect(page.getByTestId('gallery-samesiderow')).toHaveScreenshot('samesiderow.png');
  });

  // WS20-T2 (journeys-plan §5, D-J4): the same-side card state — pre-settle price edge + both
  // post-settle framings, on the dark stage.
  test('SameSideState (WS20-T2)', async ({ page }) => {
    await expect(page.getByTestId('gallery-samesidestate')).toHaveScreenshot('same-side-state.png');
  });

  test('SweatRow (WS19-T2, live/weekday/month + up/down/unknown drift)', async ({ page }) => {
    await expect(page.getByTestId('gallery-sweatrow')).toHaveScreenshot('sweatrow.png');
  });

  // WS24-T1 (journeys-plan §5, STRETCH): the split-flap primitive + the flagged departures-board
  // skin of /sweat. Both tiles render static (the gallery passes no `animate`), so the flip-in
  // tick never needs handling here even beyond toHaveScreenshot's `animations: 'disabled'`.
  test('FlapText (WS24-T1, split-flap cells)', async ({ page }) => {
    await expect(page.getByTestId('gallery-flaptext')).toHaveScreenshot('flaptext.png');
  });

  test('DeparturesBoard (WS24-T1, arrivals-board skin)', async ({ page }) => {
    await expect(page.getByTestId('gallery-departures-board')).toHaveScreenshot(
      'departures-board.png',
    );
  });

  test('Stamp (all five variants)', async ({ page }) => {
    await expect(page.getByTestId('gallery-stamp')).toHaveScreenshot('stamp.png');
  });

  test('Stamp inks (SW3-T2)', async ({ page }) => {
    await expect(page.getByTestId('gallery-stamp-ink')).toHaveScreenshot('stamp-ink.png');
  });

  test('PriceTag', async ({ page }) => {
    await expect(page.getByTestId('gallery-pricetag')).toHaveScreenshot('pricetag.png');
  });

  test('CrowdBar (all three states)', async ({ page }) => {
    await expect(page.getByTestId('gallery-crowdbar')).toHaveScreenshot('crowdbar.png');
  });

  test('CountdownTicker (both states)', async ({ page }) => {
    const gallery = page.getByTestId('gallery-countdown');
    // Both spans render live "Xh Ym" text (§10.3/§10.4) that ticks every second and is derived
    // from `Date.now()` at the moment the demo page was server-rendered — never reproducible
    // byte-for-byte between baseline-generation time and a later CI run. Mask them; the layout
    // and label chrome around them is still fully diffed.
    await expect(gallery).toHaveScreenshot('countdown.png', {
      mask: [gallery.locator('[aria-live="polite"]')],
    });
  });

  test('StreakFlame (all four states)', async ({ page }) => {
    await expect(page.getByTestId('gallery-streakflame')).toHaveScreenshot('streakflame.png');
  });

  test('Barcode', async ({ page }) => {
    await expect(page.getByTestId('gallery-barcode')).toHaveScreenshot('barcode.png');
  });

  test('ClaimPromptEngine banner (WS7-T5, streak trigger)', async ({ page }) => {
    // The banner is `position: fixed` (bottom-right), so it renders OUTSIDE the wrapping
    // `gallery-claim-prompt-streak` section's own box (that section's flow height is just its
    // heading) — screenshot the banner's own testid, not the section, or the tile is invisible
    // in the capture. Confirmed via a bounding-box probe: the section's box was 624×20 (heading
    // only) while the banner's was 384×112 at the viewport's bottom-right corner.
    const banner = page.getByTestId('claim-prompt-engine');
    await expect(banner).toBeVisible();
    await expect(banner).toHaveScreenshot('claim-prompt-banner.png');
  });

  test.describe('ClaimSheet (WS7-T5)', () => {
    test('closed', async ({ page }) => {
      await expect(page.getByTestId('gallery-claim-sheet')).toHaveScreenshot(
        'claim-sheet-closed.png',
      );
    });

    test('open (sign-in step)', async ({ page }) => {
      const section = page.getByTestId('gallery-claim-sheet');
      await section.getByRole('button', { name: 'Open claim sheet' }).click();
      // `ClaimEntry` fetches `GET /api/v1/me` on mount; with no ghost/session cookie in a fresh
      // Playwright context that 401s straight to the sign-in phase (see `ClaimSheetGalleryDemo`'s
      // own doc comment) — wait for that phase's `data-phase` marker so the screenshot never
      // races the fetch's brief "Loading…" flash.
      await page.locator('[data-testid="claim-entry"][data-phase="signin"]').waitFor();
      // Same fixed-position reasoning as the claim-prompt banner above: the sheet is a
      // full-viewport `position: fixed` overlay, so scope the screenshot to the dialog itself
      // rather than the (much taller, mostly-empty-here) wrapping gallery section.
      await expect(page.getByTestId('claim-sheet')).toHaveScreenshot('claim-sheet-open.png');
    });
  });

  test.describe('ShareSheet (WS8-T2)', () => {
    test('closed', async ({ page }) => {
      await expect(page.getByTestId('gallery-share-sheet')).toHaveScreenshot(
        'share-sheet-closed.png',
      );
    });

    test('open', async ({ page }) => {
      const section = page.getByTestId('gallery-share-sheet');
      await section.getByRole('button', { name: 'Open share sheet' }).click();
      const dialog = page.getByTestId('share-sheet');
      // The demo's fixture pick id doesn't exist in the dev DB (`ShareSheetGalleryDemo`'s doc
      // comment), so the preview `<img>` 404s — deterministically, not flakily, since it's the
      // same fixed fixture id every run — but "the request has settled" still isn't guaranteed
      // by the dialog simply being attached. `networkidle` never fires here (the demo page has
      // its own always-on background activity unrelated to this fetch), so wait on the `<img>`
      // element's own load/error settlement instead — either event means the broken-image state
      // (not an in-flight loading spinner) is what gets captured.
      await dialog.waitFor();
      const preview = page.getByTestId('share-preview-image');
      await preview.evaluate((img: HTMLImageElement) =>
        img.complete
          ? undefined
          : new Promise<void>((resolve) => {
              img.addEventListener('load', () => resolve(), { once: true });
              img.addEventListener('error', () => resolve(), { once: true });
            }),
      );
      await expect(dialog).toHaveScreenshot('share-sheet-open.png');
    });
  });
});
