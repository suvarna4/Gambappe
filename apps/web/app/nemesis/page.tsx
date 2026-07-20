import { redirect } from 'next/navigation';
import { NEMESIS_MIN_PICKS, now } from '@receipts/core';
import { getProfileByUserId } from '@receipts/db';
import { auth } from '../../auth';
import { NemesisAssignmentCard } from '@/components/nemesis/NemesisAssignmentCard';
import { NemesisHistoryList } from '@/components/nemesis/NemesisHistoryList';
import { NemesisMatchupCard } from '@/components/nemesis/NemesisMatchupCard';
import type { DayResult } from '@/components/nemesis/VerdictCard';
import { deriveDayResults } from '@/lib/nemesis/verdict';
import {
  getCurrentPairingForProfile,
  getNemesisHistoryPage,
  getPairingPublicById,
  getPairingSideRef,
  NEMESIS_HISTORY_DEFAULT_LIMIT,
} from '@/lib/nemesis/service';
import { getDb } from '@/lib/stores';
import type { PairingSide } from '@/lib/nemesis/types';

/**
 * `/nemesis` — the claimed viewer's own nemesis hub: current pairing (assignment reveal +
 * full matchup) and lifetime history with the rematch-request flow (design doc §19.3
 * WS7-T6 deliverables: "Assignment reveal card, matchup page, history").
 *
 * Not in the design doc's §10.1 route table (only `/vs/[pairingId]` is listed there) — this
 * route was WS7-T6's own addition, documented in its PR description rather than silently
 * invented. Rationale: `GET /pairings/current`, `GET /me/nemesis-history`, and
 * `POST /rematch-requests*` are all `claimed`-auth endpoints (§9.2) with no viewer-specific
 * data allowed on the public `/vs/[pairingId]` route (INV-10) — they need a private home.
 *
 * WS5-T4: resolves the real viewer via `auth()` + `getProfileByUserId` (mirroring
 * `/claim/page.tsx`'s own direct `auth()` use — no `Request`-argument-free identity resolver
 * exists yet for server components, so this follows that closest existing pattern rather than
 * inventing a new one) and reads real pairing/history data from `@/lib/nemesis/service`,
 * replacing WS7-T6's hardcoded mock `VIEWER` fixture.
 *
 * WS5-T5: `RematchPanel` (inside `NemesisHistoryList`) now talks to the real
 * `/api/v1/rematch-requests*` endpoints instead of the (deleted) mock backend. Each history
 * row's rematch state is server-rendered here too — `getNemesisHistoryPage` folds it into
 * `entry.rematch_request` (a §9.2 contract-change, see `nemesisRematchStateSchema`'s header in
 * `@receipts/core`) — so the panel never needs its own discovery fetch on mount.
 *
 * A ghost (ineligible) or signed-out visitor is redirected to `/claim` — this page has no
 * spectator-safe empty state to fall back to (unlike `/vs/[pairingId]`, which is public by
 * design).
 */
export const dynamic = 'force-dynamic';

export default async function NemesisHomePage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/claim');

  const db = getDb();
  const profile = await getProfileByUserId(db, session.user.id);
  if (!profile || profile.kind !== 'claimed') redirect('/claim');

  const viewerProfileId = profile.id;
  const at = now();
  const [pairing, historyPage] = await Promise.all([
    getCurrentPairingForProfile(db, viewerProfileId, at),
    getNemesisHistoryPage(db, viewerProfileId, { limit: NEMESIS_HISTORY_DEFAULT_LIMIT }),
  ]);

  let opponentSide: PairingSide | null = null;
  let sides: { a: PairingSide; b: PairingSide } | null = null;
  if (pairing) {
    const opponentRef = pairing.a.profile_id === viewerProfileId ? pairing.b : pairing.a;
    const viewerRef = pairing.a.profile_id === viewerProfileId ? pairing.a : pairing.b;
    const [opponentFull, viewerFull] = await Promise.all([
      getPairingSideRef(db, opponentRef.slug),
      getPairingSideRef(db, viewerRef.slug),
    ]);
    opponentSide = opponentFull ?? {
      profile_id: opponentRef.profile_id,
      handle: opponentRef.handle,
      slug: opponentRef.slug,
      rating: null,
    };
    const viewerSideFull = viewerFull ?? {
      profile_id: viewerRef.profile_id,
      handle: viewerRef.handle,
      slug: viewerRef.slug,
      rating: null,
    };
    sides =
      pairing.a.profile_id === viewerProfileId
        ? { a: viewerSideFull, b: opponentSide }
        : { a: opponentSide, b: viewerSideFull };
  }

  // SW10-T2: the verdict card's week-strip dots come from each history entry's own pairing
  // scoreboard (`GET /pairings/:id`, `pairingPublicSchema.scoreboard`) — the history entry itself
  // (`nemesisHistoryEntrySchema`) carries no per-day data. Skipped for `cancelled` entries: no
  // verdict card ever renders for those, so the fetch would be wasted.
  const verdictEligible = historyPage.data.filter((entry) => entry.outcome !== 'cancelled');
  const verdictPairings = await Promise.all(
    verdictEligible.map((entry) => getPairingPublicById(db, entry.pairing_id, at)),
  );
  const dayResultsByPairingId: Record<string, ReadonlyArray<DayResult>> = {};
  verdictEligible.forEach((entry, i) => {
    const verdictPairing = verdictPairings[i];
    if (verdictPairing) {
      dayResultsByPairingId[entry.pairing_id] = deriveDayResults(
        verdictPairing.scoreboard,
        viewerProfileId,
        verdictPairing,
      );
    }
  });

  return (
    <main className="mx-auto max-w-xl space-y-8 px-6 py-10">
      <h1 className="text-2xl font-bold">Your nemesis</h1>

      {pairing && opponentSide && sides ? (
        <div className="space-y-6">
          <NemesisAssignmentCard
            pairingId={pairing.id}
            opponent={opponentSide}
            isRematch={pairing.is_rematch}
          />
          <NemesisMatchupCard pairing={pairing} sides={sides} viewerProfileId={viewerProfileId} />
        </div>
      ) : (
        <p className="text-muted text-sm">
          No active pairing this week — nemesis assignments go out Monday 9am ET once you have{' '}
          {NEMESIS_MIN_PICKS} graded picks.
        </p>
      )}

      <section>
        <h2 className="mb-3 text-lg font-semibold">History</h2>
        <NemesisHistoryList
          viewerProfileId={viewerProfileId}
          entries={historyPage.data}
          dayResultsByPairingId={dayResultsByPairingId}
        />
      </section>
    </main>
  );
}
