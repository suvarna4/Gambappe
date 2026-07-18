'use client';

import { useMemo } from 'react';
import { NEMESIS_MIN_PICKS } from '@receipts/core';
import { NemesisAssignmentCard } from '@/components/nemesis/NemesisAssignmentCard';
import { NemesisHistoryList } from '@/components/nemesis/NemesisHistoryList';
import { NemesisMatchupCard } from '@/components/nemesis/NemesisMatchupCard';
import { getCurrentPairing, getNemesisHistory, getProfileRef } from '@/lib/nemesis/mock-api';
import { VIEWER } from '@/lib/nemesis/mock-fixtures';
import type { PairingSide } from '@/lib/nemesis/types';

/**
 * `/nemesis` — the claimed viewer's own nemesis hub: current pairing (assignment reveal +
 * full matchup) and lifetime history with the rematch-request flow (design doc §19.3
 * WS7-T6 deliverables: "Assignment reveal card, matchup page, history").
 *
 * Not in the design doc's §10.1 route table (only `/vs/[pairingId]` is listed there) — this
 * route is this task's own addition, documented here and in the PR description rather than
 * silently invented. Rationale: `GET /pairings/current`, `GET /me/nemesis-history`, and
 * `POST /rematch-requests*` are all `claimed`-auth endpoints (§9.2) with no viewer-specific
 * data allowed on the public `/vs/[pairingId]` route (INV-10) — they need a private,
 * fully-client-rendered home, and the task brief explicitly asks for "the viewer's current
 * nemesis pairing" plus the rematch flow as one coherent page.
 *
 * SPEC-GAP(WS7-T6): "the viewer" here is hardcoded to the mock's `VIEWER` fixture profile,
 * not resolved from a real session. `GET /me` (§9.2, `ghost+` auth) has no route handler on
 * this branch yet — once it does, this page should resolve the real viewer profile_id from
 * it (redirecting to `/claim` if not `claimed`) instead of importing a fixture constant.
 */
export default function NemesisHomePage() {
  const data = useMemo(() => {
    const { pairing } = getCurrentPairing(VIEWER.profile_id);
    const history = getNemesisHistory(VIEWER.profile_id).data;

    let opponentSide: PairingSide | null = null;
    let sides: { a: PairingSide; b: PairingSide } | null = null;
    if (pairing) {
      const opponentRef = pairing.a.profile_id === VIEWER.profile_id ? pairing.b : pairing.a;
      const viewerRef = pairing.a.profile_id === VIEWER.profile_id ? pairing.a : pairing.b;
      const opponentFull = getProfileRef(opponentRef.slug) ?? {
        profile_id: opponentRef.profile_id,
        handle: opponentRef.handle,
        slug: opponentRef.slug,
        rating: null,
      };
      const viewerFull = getProfileRef(viewerRef.slug) ?? {
        profile_id: viewerRef.profile_id,
        handle: viewerRef.handle,
        slug: viewerRef.slug,
        rating: null,
      };
      opponentSide = opponentFull;
      sides =
        pairing.a.profile_id === VIEWER.profile_id
          ? { a: viewerFull, b: opponentFull }
          : { a: opponentFull, b: viewerFull };
    }

    return { pairing, history, opponentSide, sides };
  }, []);

  const { pairing, history, opponentSide, sides } = data;

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
          <NemesisMatchupCard pairing={pairing} sides={sides} viewerProfileId={VIEWER.profile_id} />
        </div>
      ) : (
        <p className="text-muted text-sm">
          No active pairing this week — nemesis assignments go out Monday 9am ET once you have{' '}
          {NEMESIS_MIN_PICKS} graded picks.
        </p>
      )}

      <section>
        <h2 className="mb-3 text-lg font-semibold">History</h2>
        <NemesisHistoryList viewerProfileId={VIEWER.profile_id} entries={history} />
      </section>
    </main>
  );
}
