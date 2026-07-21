/**
 * WS22-T2 · `/crowd` — the Crowd room (D-J7, journeys-plan §5). Weekly leaderboards on the
 * already-built API: Overall + per-topic chips + the edge column. Server-rendered on the dark
 * stage (`bg-bg text-paper` from the root layout), which also keeps any colored chrome clear of
 * the cream-`bg-paper` contrast trap.
 *
 * Render mode (WS23-T2 doc reconciliation, docs/journeys-plan.md §5): this page is
 * `dynamic = 'force-dynamic'` (SSR per request), NOT the `revalidate = 60` ISR the §5 WS22-T2 AC
 * sketched — a deliberate, recorded deviation (see the `export const dynamic` note below and
 * receipts-design-doc.md §10.3). INV-10 is UNCHANGED: it server-fetches through the lib —
 * `getCrowdBoards(getDb())`, which composes `@receipts/db`'s `getLeaderboardPicksForWeek` repo +
 * `rankLeaderboard` — NOT by HTTP-calling its own `/api/v1/leaderboards/weekly` (no self-HTTP). No
 * cookies are read here and no viewer identity is resolved: the viewer's row highlight (and their
 * own streak flame) hydrates client-side inside `CrowdBoards` via `GET /api/v1/me`, so a returning
 * ghost's cookie never fragments any cache and the server HTML stays byte-identical for every viewer.
 */
import type { Metadata } from 'next';
import { PRODUCT_NAME } from '@receipts/core';
import { getDb } from '@/lib/stores';
import { getCrowdBoards } from '@/lib/leaderboard-page';
import { CrowdBoards } from '@/components/crowd/CrowdBoards';
import { crowdCopy } from '@/lib/copy';

// Rendered per-request (SSR), NOT ISR. §5's AC sketches ISR-60s, but the page reads the DB at
// render and (a) `next build` would prerender it with no/unmigrated DB in CI (verify has no
// DATABASE_URL; the e2e job builds before it migrates), and (b) an ISR snapshot can't reflect
// standings seeded after the build (the WS22-T2 e2e seeds a winner and expects it live). Both
// dissolve under force-dynamic. INV-10 is UNCHANGED: this render reads no cookies and resolves no
// viewer identity (`getCrowdBoards(getDb())` takes only a Db), so the HTML is byte-identical for
// every viewer — the row highlight still hydrates client-side. A CDN can still edge-cache it since
// it's viewer-free. WS23-T2 records this ISR→force-dynamic deviation in receipts-design-doc.md
// §10.3 (docs/journeys-plan.md §5); true ISR (build-empty + on-demand revalidate) stays a
// possible future revisit, not a shipped requirement.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: `Crowd — ${PRODUCT_NAME}`,
  description: 'Weekly leaderboards — the sharpest calls of the week, overall and by topic.',
};

export default async function CrowdPage() {
  const view = await getCrowdBoards(getDb());
  const anyEntries = view.boards.some((b) => b.entries.length > 0);

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <header className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight">{crowdCopy.heading}</h1>
        <p className="text-muted mt-1 text-sm">{crowdCopy.subheading}</p>
      </header>

      {anyEntries ? (
        <CrowdBoards boards={view.boards} weekStart={view.weekStart} live={view.live} />
      ) : (
        <p data-testid="crowd-empty-week" className="text-muted py-12 text-center text-sm">
          {crowdCopy.emptyWeek}
        </p>
      )}
    </main>
  );
}
