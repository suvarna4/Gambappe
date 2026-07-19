/**
 * `/ladder` — the public duo tier ladder (design doc §10.1 route table: "duo pages, flag
 * `duo_queue`"; §8.10 ladder; §9.2 `GET /duo/ladder`: "tier standings, paginated"; §19.3
 * WS7-T7 "ladder view with tier/pagination").
 *
 * SPEC-GAP(ws7-t7): §10.1 lists "ISR 60s" for the duo pages row, but that's not achievable
 * here the way `/duos/[id]` and `/p/[slug]` get it — both of THOSE have a dynamic path segment
 * (`[id]`/`[slug]`) that already forces per-request rendering, so `export const revalidate = 60`
 * (ISR) and reading `searchParams` coexist fine. `/ladder` has no such segment, so Next tries to
 * fully static-optimize it at build time; combined with reading `searchParams` for cursor/tier
 * pagination (this task's own pragmatic addition — §9.2's endpoint is paginated, the page has
 * to expose that somehow), that combination throws `DYNAMIC_SERVER_USAGE` at request time. This
 * renders per-request instead (`export const dynamic = 'force-dynamic'`, same posture as
 * `/duo`'s own page.tsx) — Next's implicit "dynamic because it reads searchParams" inference
 * turned out to still statically prerender this specific route at build time (no dynamic path
 * segment to force its hand), which would freeze pagination/tier-filter output at whatever
 * `searchParams` happened to resolve to during `next build` (empty) instead of the real
 * request's query string; an explicit config avoids relying on that inference. The underlying
 * `GET /duo/ladder` API route still serves
 * `Cache-Control: public, s-maxage=30, stale-while-revalidate=300` (§9.1) — that's the layer
 * actually absorbing repeat-request load, this page's own SSR just isn't ALSO CDN-cached the
 * way a static/ISR route would be.
 *
 * §10.2/INV-10: viewer-free server render, same posture as `/duos/[id]` and `/p/[slug]`.
 * Pagination follows `/p/[slug]`'s own cursor-in-query-param + "Load more" link convention
 * (`getDuoLadderPage`'s cursor is an opaque base64url offset, §9.1: "cursor-based... OPAQUE to
 * the client").
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isFlagEnabled, now } from '@receipts/core';
import { getDb } from '@/lib/stores';
import { getDuoLadderPage } from '@/lib/duo-ladder';
import { DuoLadderTable } from '@/components/duo/DuoLadderTable';
import { duoCopy } from '@/lib/copy';

export const dynamic = 'force-dynamic';

interface PageSearchParams {
  cursor?: string;
  tier?: string;
}

interface PageProps {
  searchParams: Promise<PageSearchParams>;
}

export const metadata: Metadata = {
  title: `${duoCopy.ladderHeading} — Receipts`,
  description: 'Duo tier standings.',
};

export default async function LadderPage({ searchParams }: PageProps) {
  if (!isFlagEnabled('duo_queue')) notFound();

  const { cursor, tier } = await searchParams;
  const parsedTier = tier ? Number.parseInt(tier, 10) : undefined;

  const page = await getDuoLadderPage(
    getDb(),
    {
      cursor: cursor ?? undefined,
      tier: parsedTier !== undefined && Number.isFinite(parsedTier) ? parsedTier : undefined,
    },
    now(),
  );

  const nextHref = page.meta.next_cursor
    ? `/ladder?cursor=${encodeURIComponent(page.meta.next_cursor)}${parsedTier ? `&tier=${parsedTier}` : ''}`
    : null;

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-10">
      <h1 className="text-2xl font-bold">{duoCopy.ladderHeading}</h1>

      <DuoLadderTable entries={page.data} />

      {nextHref ? (
        <Link href={nextHref} className="text-side-a inline-block text-sm underline underline-offset-2">
          {duoCopy.ladderLoadMore}
        </Link>
      ) : null}
    </main>
  );
}
