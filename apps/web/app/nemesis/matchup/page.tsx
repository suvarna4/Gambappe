import Link from 'next/link';
import { redirect } from 'next/navigation';
import { now } from '@receipts/core';
import { getProfileByUserId } from '@receipts/db';
import { auth } from '../../../auth';
import { NemesisMatchupCard } from '@/components/nemesis/NemesisMatchupCard';
import { getCurrentPairingForProfile, getPairingSideRef } from '@/lib/nemesis/service';
import { getDb } from '@/lib/stores';
import type { PairingSide } from '@/lib/nemesis/types';

/**
 * `/nemesis/matchup` — the viewer's own current-week full matchup card (design-diff audit).
 *
 * Split out of `/nemesis/page.tsx`, which used to inline the FULL `NemesisMatchupCard` directly
 * below the compact assignment card — duplicating what's also served publicly at
 * `/vs/[pairingId]`, and stacking it into one continuous page instead of the mockup's distinct
 * nemesis-week moments. `/vs/[pairingId]` is deliberately viewer-free (INV-10, public 30s ISR —
 * see that page's own header): its server render always passes `viewerProfileId={null}`, so it
 * can never carry "You" labeling or other viewer-specific state. This route exists so the
 * viewer's OWN matchup gets that real identity threaded through instead — same data-fetching
 * shape `/nemesis/page.tsx` already used for its (now-removed) inline card: `
 * getCurrentPairingForProfile` + `getPairingSideRef` for both sides.
 *
 * Auth-gated exactly like `/nemesis/page.tsx` — same `auth()` + `getProfileByUserId` +
 * redirect-to-`/claim` pattern, copied rather than reinvented. No active pairing this week (or no
 * session at all) redirects back to `/nemesis`, which owns the real "no active pairing" copy via
 * its own state machine (`lib/nemesis/page-state.ts`) — this route has no spectator-safe empty
 * state of its own, matching `/nemesis/page.tsx`'s own reasoning for why IT redirects rather than
 * rendering a placeholder inline.
 */
export const dynamic = 'force-dynamic';

export default async function NemesisMatchupPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/claim');

  const db = getDb();
  const profile = await getProfileByUserId(db, session.user.id);
  if (!profile || profile.kind !== 'claimed') redirect('/claim');

  const viewerProfileId = profile.id;
  const at = now();
  const pairing = await getCurrentPairingForProfile(db, viewerProfileId, at);
  if (!pairing) redirect('/nemesis');

  const opponentRef = pairing.a.profile_id === viewerProfileId ? pairing.b : pairing.a;
  const viewerRef = pairing.a.profile_id === viewerProfileId ? pairing.a : pairing.b;
  const [opponentFull, viewerFull] = await Promise.all([
    getPairingSideRef(db, opponentRef.slug),
    getPairingSideRef(db, viewerRef.slug),
  ]);
  const opponentSide: PairingSide = opponentFull ?? {
    profile_id: opponentRef.profile_id,
    handle: opponentRef.handle,
    slug: opponentRef.slug,
    rating: null,
  };
  const viewerSide: PairingSide = viewerFull ?? {
    profile_id: viewerRef.profile_id,
    handle: viewerRef.handle,
    slug: viewerRef.slug,
    rating: null,
  };
  const sides =
    pairing.a.profile_id === viewerProfileId
      ? { a: viewerSide, b: opponentSide }
      : { a: opponentSide, b: viewerSide };

  return (
    <main className="mx-auto max-w-xl space-y-6 px-6 py-10">
      <Link href="/nemesis" className="text-muted text-sm underline underline-offset-2">
        ← Your nemesis
      </Link>
      <h1 className="text-2xl font-bold">Matchup</h1>
      <NemesisMatchupCard pairing={pairing} sides={sides} viewerProfileId={viewerProfileId} />
    </main>
  );
}
