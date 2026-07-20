import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { now, PRODUCT_NAME } from '@receipts/core';
import { NemesisMatchupCard } from '@/components/nemesis/NemesisMatchupCard';
import { appUrl } from '@/lib/app-url';
import { getPairingPublicById, getPairingSideRef } from '@/lib/nemesis/service';
import { getDb } from '@/lib/stores';
import type { PairingSide } from '@/lib/nemesis/types';

/**
 * `/vs/[pairingId]` — the public nemesis matchup page (design doc §10.1 route table;
 * §19.3 WS7-T6 "matchup page" deliverable). ISR 30s, same as other public matchup-ish
 * pages (§10.1: "`/vs/[pairingId]` | ISR 30s | public matchup").
 *
 * INV-10 compliance: this server render is viewer-free by construction —
 * `NemesisMatchupCard` is called with `viewerProfileId={null}` here, always. The
 * rematch-request flow needs `claimed` auth and a real identity check, so it lives entirely
 * on the private `/nemesis` hub page instead of being bolted onto this public, cache-shared
 * route. SW10-T4 (wiring-gaps doc §4) DOES mount one client viewer island here —
 * `ReactionStampsPanel` (inside `NemesisMatchupCard`) — but it self-fetches identity
 * post-hydration the same way `ViewerStrip`/`QuestionThread` do on ISR'd pages elsewhere, so
 * this page's SERVER render stays exactly as viewer-free as before; see that component's own
 * header for why its first paint can never carry real viewer state.
 *
 * WS5-T4: now backed by real Postgres reads (`@/lib/nemesis/service`, §9.2 `GET /pairings/:id`
 * + a `GET /profiles/:slug`-equivalent rating composition), replacing WS7-T6's original mock.
 * `getPairingPublicById`/`getPairingSideRef` return the exact same `@receipts/core`-schema
 * shapes the mock did, so `NemesisMatchupCard` needed no changes. WS5-T5 subsequently deleted
 * the mock module entirely (`lib/nemesis/mock-api.ts`) once the rematch-request flow it backed
 * got real `/api/v1/rematch-requests*` endpoints — see `/nemesis/page.tsx`'s header.
 *
 * The `/api/oembed` SPEC-GAP this page's header used to flag (mock pairing ids had no
 * corresponding real `nemesis_pairings` row, so the oEmbed link 404'd) is resolved now that
 * `pairingId` is a real id.
 */
export const revalidate = 30;

interface PageProps {
  params: Promise<{ pairingId: string }>;
}

function fallbackSide(profileId: string, handle: string, slug: string): PairingSide {
  return { profile_id: profileId, handle, slug, rating: null };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { pairingId } = await params;
  const pairing = await getPairingPublicById(getDb(), pairingId, now());
  if (!pairing) return { title: `Matchup not found — ${PRODUCT_NAME}` };
  const pageUrl = `${appUrl()}/vs/${pairingId}`;
  return {
    title: `${pairing.a.handle} vs ${pairing.b.handle} — ${PRODUCT_NAME}`,
    description: `Nemesis matchup: ${pairing.a.handle} vs ${pairing.b.handle}, week of ${pairing.week_start}.`,
    alternates: {
      types: {
        'application/json+oembed': `${appUrl()}/api/oembed?url=${encodeURIComponent(pageUrl)}`,
      },
    },
  };
}

export default async function PairingPage({ params }: PageProps) {
  const { pairingId } = await params;
  const db = getDb();
  const pairing = await getPairingPublicById(db, pairingId, now());
  if (!pairing) notFound();

  const [aRef, bRef] = await Promise.all([
    getPairingSideRef(db, pairing.a.slug),
    getPairingSideRef(db, pairing.b.slug),
  ]);

  return (
    <main className="mx-auto max-w-xl px-6 py-10">
      <NemesisMatchupCard
        pairing={pairing}
        sides={{
          a: aRef ?? fallbackSide(pairing.a.profile_id, pairing.a.handle, pairing.a.slug),
          b: bRef ?? fallbackSide(pairing.b.profile_id, pairing.b.handle, pairing.b.slug),
        }}
        viewerProfileId={null}
      />
    </main>
  );
}
