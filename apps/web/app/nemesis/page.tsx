import { redirect } from 'next/navigation';
import { getProfileByUserId } from '@receipts/db';
import { auth } from '../../auth';
import { NemesisRoom } from './NemesisRoom';
import { getDb } from '@/lib/stores';

/**
 * `/nemesis` — the claimed viewer's own nemesis hub (design doc §19.3 WS7-T6 deliverables:
 * "Assignment reveal card, matchup page, history").
 *
 * Not in the design doc's §10.1 route table (only `/vs/[pairingId]` is listed there) — this
 * route was WS7-T6's own addition, documented in its PR description rather than silently
 * invented. Rationale: `GET /pairings/current`, `GET /me/nemesis-history`, and
 * `POST /rematch-requests*` are all `claimed`-auth endpoints (§9.2) with no viewer-specific
 * data allowed on the public `/vs/[pairingId]` route (INV-10) — they need a private home.
 *
 * WS17-T2 (journeys plan §5): the three-state body — assignment / verdict / empty — now lives in
 * the co-located `NemesisRoom` server component so the new segmented `/rivals?tab=nemesis` hub can
 * reuse it (see that file's header for the extraction rationale, and `NemesisRoom` itself for the
 * state machine's own design history). This page keeps ownership of the auth/redirect gate: a
 * ghost (ineligible) or signed-out visitor is redirected to `/claim` — this standalone route has
 * no spectator-safe empty state to fall back to (unlike `/vs/[pairingId]`, which is public by
 * design; and unlike the hub, which renders the neutral save-gate panel instead of redirecting).
 * The `<main>` wrapper (and thus the rendered DOM and every nemesis-e2e `data-testid`) is
 * unchanged from before the extraction.
 */
export const dynamic = 'force-dynamic';

export default async function NemesisHomePage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/claim');

  const db = getDb();
  const profile = await getProfileByUserId(db, session.user.id);
  if (!profile || profile.kind !== 'claimed') redirect('/claim');

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col space-y-8 px-6 py-10">
      <NemesisRoom profile={profile} />
    </main>
  );
}
