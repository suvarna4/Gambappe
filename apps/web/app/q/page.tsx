/**
 * `/q` — the question archive (design doc §10.1: "ISR daily | past questions list | SEO surface
 * (\"Will X happen? The crowd said 63%\")"), WS8-T5.
 *
 * `dynamic = 'force-dynamic'`, same choice and same reason as `app/sitemap.ts` (WS8-T4): with no
 * dynamic path segment to defer on, Next tries to statically prerender this page at `pnpm build`
 * time — which fails in CI's build step, since `pnpm build` runs with no `DATABASE_URL`
 * configured (§17.3; `.github/workflows/ci.yml`'s `verify` job only wires DB env vars into the
 * later integration job). This means the design doc's "ISR daily" is approximated rather than
 * literal: every request re-reads Postgres instead of serving a cached render. At today's/
 * expected volume (~1 revealed daily question/day) that's a cheap, indexed query, and a
 * reverse-proxy/CDN layer in front of this route can still absorb repeat-request load via its
 * own `Cache-Control`, the same tradeoff already accepted for `/ladder` (WS7-T7).
 *
 * No `searchParams`-based pagination (see `lib/archive.ts`'s `ARCHIVE_ENTRY_CAP` comment) — this
 * page already has no Dynamic API dependency beyond the forced-dynamic choice above, so adding
 * one for pagination isn't a further tradeoff worth taking at today's archive size.
 */
import type { Metadata } from 'next';
import { appUrl } from '@/lib/app-url';
import { loadArchiveListing } from '@/lib/archive';
import { buildArchiveJsonLd } from '@/lib/structured-data';
import { getDb } from '@/lib/stores';

export const dynamic = 'force-dynamic';

const ARCHIVE_TITLE = 'Question archive — Receipts';
const ARCHIVE_DESCRIPTION = 'Past daily questions and how the crowd called them.';

export async function generateMetadata(): Promise<Metadata> {
  const pageUrl = `${appUrl()}/q`;
  return {
    title: ARCHIVE_TITLE,
    description: ARCHIVE_DESCRIPTION,
    alternates: { canonical: pageUrl },
    openGraph: {
      title: ARCHIVE_TITLE,
      description: ARCHIVE_DESCRIPTION,
      url: pageUrl,
    },
  };
}

export default async function ArchivePage() {
  const { entries } = await loadArchiveListing(getDb());
  const origin = appUrl();
  const jsonLd = buildArchiveJsonLd(origin, entries);

  return (
    <main className="mx-auto max-w-xl space-y-6 px-6 py-10">
      <h1 className="text-lg font-semibold">Question archive</h1>
      {entries.length === 0 ? (
        <p className="text-muted text-sm" data-testid="archive-empty">
          No revealed questions yet.
        </p>
      ) : (
        <ul className="divide-surface divide-y" data-testid="archive-list">
          {entries.map((entry) => (
            <li key={entry.slug} className="py-4">
              <a href={`/q/${entry.slug}`} className="block space-y-1">
                <span className="block font-semibold">{entry.headline}</span>
                <span className="text-muted block text-sm">{entry.description}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </main>
  );
}
