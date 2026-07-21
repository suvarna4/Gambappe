/**
 * Playwright E2E config (WS0-T1 wiring; §17.1 E2E runs chromium against the dev stack with
 * MockVenueAdapter). Assumes `next build` has run; starts `next start` itself.
 */
import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';

// WS10-T1 admin-auth.spec.ts needs a known stopgap token + allowlist; harmless test-only
// defaults so CI/local runs don't need to export these just to run e2e (webServer inherits
// process.env as-is, so setting them here before defineConfig is enough).
process.env.ADMIN_STOPGAP_TOKEN ??= 'e2e-test-stopgap-token';
process.env.ADMIN_STOPGAP_IP_ALLOWLIST ??= '127.0.0.1';
// WS7-T7 duo.spec.ts exercises `/duo`, `/duos/[id]`, `/ladder` — all behind the `duo_queue`
// flag (§4.6), same as every duo API route (default off, §19.5 "Gate P1.5: duo behind flag
// until one internal ladder window completes cleanly"). Same inherit-into-webServer mechanism
// as `ADMIN_STOPGAP_TOKEN` above.
process.env.FLAG_DUO_QUEUE ??= 'true';
// WS5-T5 nemesis-rematch.spec.ts exercises `/nemesis` and the real `/api/v1/rematch-requests*`
// routes — all behind the `nemesis` flag (§4.6: "off until WS5 E2E passes"). WS5-T5 is the last
// task on that workstream's WBS row, so its own e2e suite flipping this on here is exactly what
// "until WS5 E2E passes" means — same inherit-into-webServer mechanism as `FLAG_DUO_QUEUE` above.
// (`nemesis-matchup.spec.ts`, WS5-T4, predates this and only reads `/vs/[pairingId]` — an
// unflagged SSR page — so it never needed this default; the flag still gated it implicitly
// since that page's own data functions don't check it, only the `/api/v1/*` route handlers do.)
process.env.FLAG_NEMESIS ??= 'true';
// WS20-T4 callouts-loop.spec.ts exercises the `/rivals` call-out surfaces + the real
// `/api/v1/callouts*` routes — all behind the `callouts` flag (journeys plan §4, default off until
// WS23-T2's E2E gate). This task's own e2e flipping it on here mirrors FLAG_NEMESIS/FLAG_DUO_QUEUE
// above (same inherit-into-webServer mechanism).
process.env.FLAG_CALLOUTS ??= 'true';
// WS14-T1 golden-loop.spec.ts calls the real `POST /internal/revalidate` (§9.2) to force fresh
// ISR after directly advancing question state (lock/reveal) via repository calls instead of the
// real worker cron — same "harmless test-only default" rationale as the stopgap token above.
process.env.INTERNAL_API_SECRET ??= 'e2e-test-internal-secret';
// Auth.js requires `secret` to be configured (`auth.ts`) — without it, `auth()` logs
// `MissingSecret` and silently resolves every request as unauthenticated instead of throwing,
// which every OTHER e2e spec never notices (none of them depend on `auth()` actually resolving
// a real session — they're anonymous/ghost-only scenarios where "no session" is the expected
// outcome anyway). `golden-loop.spec.ts` is the first spec that seeds a real Auth.js database
// session and needs `auth()` to actually recognize it (the claim-completion step) — CI's e2e
// job doesn't set `AUTH_SECRET` (`.github/workflows/ci.yml`), so without this default the claim
// step deterministically renders the pre-auth `ClaimEntry` instead of `ClaimCompletion` there,
// even though it's invisible locally if you happen to always export `AUTH_SECRET` by hand.
process.env.AUTH_SECRET ??= 'e2e-test-auth-secret-e2e-test-auth-secret';
// `apps/web/lib/venues.ts`'s `defaultVenueAdapters()` constructs a real `KalshiAdapter`/
// `PolymarketAdapter` eagerly (§6.2 step 4's synchronous price-fetch fallback) — construction
// itself throws when these base-URL env vars are unset, regardless of whether the fetch is ever
// reached. `golden-loop.spec.ts` primes the real Redis price cache before placing its pick
// (staying off the venue-adapter path entirely, both for realism — production keeps this cache
// warm via `venue:price-tick` — and to avoid a live-network-call's timing variance counting
// against §19.3's <1% flake-rate AC), but these still guard the OTHER rungs of the ladder any
// future real (non-`page.route`-mocked) pick placement would fall through to on a cache miss:
// without dummy values, construction itself 500s before ever reaching the DB-fallback rung.
// Port 1 is always closed — a fetch that does reach it fails fast (ECONNREFUSED) rather than
// hanging for the venue-fetch's 2s timeout.
process.env.KALSHI_API_BASE ??= 'http://127.0.0.1:1';
process.env.POLYMARKET_GAMMA_BASE ??= 'http://127.0.0.1:1';
process.env.POLYMARKET_CLOB_BASE ??= 'http://127.0.0.1:1';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // SW10-T5: `'github'` alone (the pre-existing CI value) never writes an `apps/web/playwright-
  // report` directory — that's the `'html'` reporter's job, and CI wasn't running it. Confirmed
  // by forcing a local failure with `reporter: 'github'` and `CI=true`: the run correctly failed
  // and wrote `-actual.png`/`-expected.png`/`-diff.png` under `test-results/`, but no
  // `playwright-report/` was created at all. `.github/workflows/ci.yml`'s "Upload Playwright
  // report on failure" step has always uploaded that (never-created) path on failure — silently
  // producing an empty/near-empty artifact, for every e2e spec, not just this task's new visual
  // ones. Adding `'html'` alongside the existing `'github'` reporter is the minimal fix: it makes
  // that already-wired upload step actually contain something (the HTML report embeds the
  // actual/expected/diff images for every failed `toHaveScreenshot`, browsable without re-running
  // anything), with no CI YAML change needed — matching this task's "extend that rather than
  // inventing new plumbing" instruction. `open: 'never'` keeps CI from trying to launch a browser
  // to view it (the local `list` reporter path is unaffected).
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  expect: {
    // SW10-T5 (wiring-gaps doc §4): `toHaveScreenshot` tolerance for the `/dev/ui` visual
    // regression gate (`e2e/dev-ui-visual.spec.ts`). Playwright's own default is a byte-exact
    // pixel match, which is unrealistically strict across font-rendering stacks — sub-pixel
    // antialiasing on glyph edges (the gallery is text-heavy: Barlow Condensed headlines, mono
    // numerals) shifts a handful of pixels between otherwise-identical renders even on the SAME
    // browser build. `threshold` (0.2, pixelmatch's own default) is the per-pixel YIQ color
    // distance before a pixel counts as "different" at all — left at default, it already
    // absorbs most antialiasing drift. `maxDiffPixelRatio: 0.02` is the extra margin on top:
    // up to 2% of a tile's pixels may differ (beyond `threshold`) before the assertion fails.
    // 2% is generous enough to absorb minor cross-environment font hinting differences but
    // still catches anything a human would call a real visual change — the deliberate one-pixel
    // style change this task's AC demands (see the PR description) changes a border/color over
    // a much larger area than 2% of its tile and fails cleanly under this budget.
    // RISK (documented in this task's PR description, flagged per SW10-T5's own process step):
    // baselines committed by this task were generated against whatever Chromium build this
    // dev sandbox had pre-cached, NOT a freshly `playwright install`-ed one matching this
    // `@playwright/test` version exactly — the sandbox's outbound network policy blocks
    // `cdn.playwright.dev`, so parity with CI's `playwright install --with-deps chromium` step
    // (`.github/workflows/ci.yml`) could not be independently confirmed here. If CI's first run
    // on this PR shows diffs that are clearly rendering-only (not the covered components' actual
    // layout), regenerate baselines from an environment that mirrors CI's browser install
    // exactly (or from CI itself) rather than loosening this budget further.
    toHaveScreenshot: { maxDiffPixelRatio: 0.02 },
  },
  use: {
    baseURL,
    trace: 'on-first-retry',
    // WS8-T2's share sheet calls `navigator.clipboard.writeText` on copy-link — Chromium
    // denies clipboard-write by default in a headless/CI context without an explicit grant.
    permissions: ['clipboard-read', 'clipboard-write'],
    // Sandboxed/dev environments can point at a system chromium instead of downloading
    // (CI uses the standard pre-installed browsers, §17.3).
    ...(process.env.PW_CHROMIUM_PATH
      ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } }
      : {}),
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'pnpm start',
    url: `${baseURL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
