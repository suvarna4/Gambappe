/**
 * WS8-T3 scaffold: the spectator question page's server-render data, per design doc §10.2
 * (INV-10) — "Server render contains zero viewer data — identical HTML for every visitor
 * (cacheable at the CDN)."
 *
 * SPEC-GAP(WS8-T3): WS7-T2 ("Home + question page") owns the real `/q/[slug]` UI and has not
 * landed in this worktree yet (it's `mock_start_ok` against this task per §19.1, being built
 * in parallel by a different agent). This loader + the page in `app/q/[slug]/page.tsx` are a
 * deliberately minimal mock scaffold that exists so WS8-T3's ISR config, `/internal/
 * revalidate` wiring, and the cookie-agnostic cache-key guarantee have something real to
 * attach to and test. Whoever lands WS7-T2 should replace the page's JSX (not this loader's
 * *shape* — keep the "takes only a slug, returns the public question shape, never touches
 * cookies/headers" contract, since that's the architectural guarantee §10.2's cache-key test
 * depends on) with the real state-machine UI (§10.3).
 *
 * The one load-bearing property to preserve: this function's signature has NO request,
 * headers, or cookies parameter — there is nothing here a visitor's identity could vary, so
 * there is nothing for a CDN cache key to fragment on if it (wrongly) included cookies.
 */
import { getMarketById, getQuestionBySlug, type QuestionRow } from '@receipts/db';
import { getDb } from '@/lib/stores';

export interface QuestionPageView {
  slug: string;
  headline: string;
  blurb: string | null;
  status: QuestionRow['status'];
  yesLabel: string;
  noLabel: string;
  yesPrice: number | null;
  /** Only present once locked (§9.3 — hidden while `open`, no exceptions). */
  crowd: { yesPct: number } | null;
  outcome: QuestionRow['outcome'];
  openAt: string;
  lockAt: string;
  revealAt: string;
}

function toView(row: QuestionRow, yesPrice: number | null): QuestionPageView {
  const lockedOrLater = row.status === 'locked' || row.status === 'revealed';
  const yes = row.crowdYesAtLock ?? 0;
  const no = row.crowdNoAtLock ?? 0;
  const total = yes + no;

  return {
    slug: row.slug ?? '',
    headline: row.headline,
    blurb: row.blurb,
    status: row.status,
    yesLabel: row.yesLabel,
    noLabel: row.noLabel,
    yesPrice,
    crowd: lockedOrLater ? { yesPct: total === 0 ? 50 : Math.round((yes / total) * 100) } : null,
    outcome: row.outcome,
    openAt: row.openAt.toISOString(),
    lockAt: row.lockAt.toISOString(),
    revealAt: row.revealAt.toISOString(),
  };
}

/** No request-shaped parameter, by design — see the module comment. */
export async function loadQuestionPageView(slug: string): Promise<QuestionPageView | null> {
  const db = getDb();
  const row = await getQuestionBySlug(db, slug);
  if (!row) return null;
  // Live yes-price lives on `markets`, not `questions` (§5.3) — shown even while open (§9.3).
  const market = await getMarketById(db, row.marketId);
  return toView(row, market?.yesPrice ?? null);
}
