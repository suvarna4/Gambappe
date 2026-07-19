/**
 * `/duos/[id]` — the public duo page (design doc §10.1 route table: "duo pages, flag
 * `duo_queue`"; §9.2 `GET /duos/:id`: "partners, tier, rating, chemistry, match history";
 * §19.3 WS7-T7 "the public duo page... match history"). ISR 60s, same cadence as `/ladder`
 * (§10.1's shared row for both duo pages) and matches this page's own `s-maxage=30` API
 * sibling closely enough at the page-cache layer.
 *
 * §10.2/INV-10: the server render carries ZERO viewer data — no cookies read, no identity
 * resolved, identical HTML for every visitor (mirrors `/p/[slug]/page.tsx`'s own header). The
 * disband action is deliberately NOT here — it's a claimed, member-only action (§9.2
 * `POST /duos/:id/disband`) with no place on a public, cache-shared route; it lives on the
 * private `/duo` hub instead (`DuoHubClient`'s header explains why), same split
 * `/vs/[pairingId]` vs `/nemesis` used for the rematch flow.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isFlagEnabled, PRODUCT_NAME } from '@receipts/core';
import { Barcode } from '@receipts/ui';
import { getDb } from '@/lib/stores';
import { DUO_MATCH_HISTORY_LIMIT, getDuoPublicPage } from '@/lib/serialize-duo';
import { DuoCard } from '@/components/duo/DuoCard';
import { DuoMatchHistoryList } from '@/components/duo/DuoMatchHistoryList';
import { duoCopy } from '@/lib/copy';

export const revalidate = 60; // §10.1: duo pages — ISR 60s

interface PageProps {
  params: Promise<{ id: string }>;
}

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  if (!isFlagEnabled('duo_queue')) return { title: 'Not found' };

  const { id } = await params;
  const page = await getDuoPublicPage(getDb(), id, DUO_MATCH_HISTORY_LIMIT);
  if (!page) return { title: `Duo not found — ${PRODUCT_NAME}` };

  const [a, b] = page.duo.partners;
  const title = `${a.handle} & ${b.handle} — ${PRODUCT_NAME}`;
  const description = `Duo record: ${a.handle} & ${b.handle}, ${page.duo.matches_played} matches played.`;
  const pageUrl = `${appUrl()}/duos/${page.duo.id}`;
  // §10.5: `/api/og/duo/:duoId` already exists (`apps/web/app/api/og/duo/[duoId]/route.ts`).
  const ogImageUrl = `${appUrl()}/api/og/duo/${page.duo.id}`;

  return {
    title,
    description,
    alternates: {
      canonical: pageUrl,
      types: {
        'application/json+oembed': `${appUrl()}/api/oembed?url=${encodeURIComponent(pageUrl)}`,
      },
    },
    openGraph: {
      title,
      description,
      url: pageUrl,
      images: [{ url: ogImageUrl, width: 1200, height: 630 }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [ogImageUrl],
    },
  };
}

export default async function DuoPage({ params }: PageProps) {
  if (!isFlagEnabled('duo_queue')) notFound();

  const { id } = await params;
  const page = await getDuoPublicPage(getDb(), id, DUO_MATCH_HISTORY_LIMIT);
  if (!page) notFound();

  const path = `/duos/${page.duo.id}`;

  return (
    <main className="mx-auto max-w-xl space-y-8 px-6 py-10">
      <DuoCard duo={page.duo} />

      <section aria-labelledby="duo-history-heading" className="space-y-4">
        <h2 id="duo-history-heading" className="text-lg font-semibold">
          {duoCopy.historyHeading}
        </h2>
        <DuoMatchHistoryList duoId={page.duo.id} matches={page.match_history} />
      </section>

      <Barcode path={path} />
    </main>
  );
}
