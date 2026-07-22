import type { ReactNode } from 'react';
import Link from 'next/link';
import { isFlagEnabled, now } from '@receipts/core';
import { getProfileByUserId } from '@receipts/db';
import { auth } from '../../auth';
import { getDb } from '@/lib/stores';
import { getEnabledAuthProviders } from '@/lib/auth-providers';
import ClaimEntry from '@/components/claim/ClaimEntry';
import { NemesisRoom } from '../nemesis/NemesisRoom';
import { DuoRoom } from '../duo/DuoRoom';
import { getCalloutPreview } from '@/lib/callouts';
import { getAcceptedCalloutViews, getCalloutCandidates } from '@/lib/callouts-view';
import { CalloutPanel } from '@/components/callouts/CalloutPanel';
import { AcceptedCalloutCard } from '@/components/callouts/AcceptedCalloutCard';
import { IncomingCalloutCard, type IncomingCalloutState } from '@/components/callouts/IncomingCalloutCard';
import { NemesisHistoryList } from '@/components/nemesis/NemesisHistoryList';
import { getNemesisHistoryPage, NEMESIS_HISTORY_DEFAULT_LIMIT } from '@/lib/nemesis/service';
import { calloutsCopy } from '@/lib/copy';

/**
 * `/rivals` — the one Rivals room (journeys plan D-J6 / §3 route map / §5 WS17-T2 + WS20-T4): a
 * segmented control (Nemesis · Duo) over the two rival surfaces, PLUS the WS20-T4 call-out surfaces
 * (D-J5): an incoming call-out card when the viewer arrives with `?callout={token}`, the "Call
 * someone out" panel, the accepted-call-out "locked in" confirmation, and the grudge book.
 *
 * The standalone routes (`/nemesis`, `/duo`) keep working byte-for-behavior (deep links, share
 * cards); this hub reuses their extracted bodies — `NemesisRoom` and `DuoRoom` — rather than
 * forking them (journeys plan §0 "reuse X").
 *
 * Tab selection is URL-driven (`?tab=nemesis|duo`, default nemesis). Ghost / signed-out: instead of
 * `/nemesis`'s `redirect('/claim')`, the hub renders the neutral save-gate panel inline — but an
 * incoming `?callout={token}` still renders above the gate, so a fresh ghost can preview a call-out
 * and be routed through Save to accept it (D-J8; WS21-T2 owns the post-save return).
 *
 * Seam: does not touch `layout.tsx` (WS17-T1 owns the app shell) nor another task's `copy.ts` block
 * (§7 seam 2 — WS20-T4 owns only the `calloutsCopy` block; all call-out strings live there).
 */
export const dynamic = 'force-dynamic';

type RivalsTab = 'nemesis' | 'duo';

interface PageProps {
  searchParams: Promise<{ tab?: string; callout?: string }>;
}

const TAB_BASE =
  'flex-1 rounded px-4 py-2 text-center text-sm font-semibold uppercase tracking-wide transition-colors';

function RivalsTabs({ activeTab, duoEnabled }: { activeTab: RivalsTab; duoEnabled: boolean }) {
  const activeClass = 'bg-surface text-paper';
  const inactiveClass = 'text-muted hover:text-paper';
  return (
    <nav aria-label="Rivals sections" className="bg-bg flex gap-1 rounded-lg p-1" data-testid="rivals-tabs">
      <Link
        href="/rivals?tab=nemesis"
        data-testid="rivals-tab-nemesis"
        aria-current={activeTab === 'nemesis' ? 'page' : undefined}
        className={`${TAB_BASE} ${activeTab === 'nemesis' ? activeClass : inactiveClass}`}
      >
        Nemesis
      </Link>
      {duoEnabled ? (
        <Link
          href="/rivals?tab=duo"
          data-testid="rivals-tab-duo"
          aria-current={activeTab === 'duo' ? 'page' : undefined}
          className={`${TAB_BASE} ${activeTab === 'duo' ? activeClass : inactiveClass}`}
        >
          Duo
        </Link>
      ) : null}
    </nav>
  );
}

/** Map the server-side call-out preview to the client card's serializable state (WS20-T4). */
function toIncomingState(result: Awaited<ReturnType<typeof getCalloutPreview>>): IncomingCalloutState {
  if (!result.ok) return result.reason === 'expired' ? { kind: 'expired' } : { kind: 'not_found' };
  const { status, challenger } = result.preview;
  const refs = { challengerHandle: challenger.handle, challengerSlug: challenger.slug };
  if (status === 'accepted') return { kind: 'accepted', ...refs };
  if (status === 'declined') return { kind: 'declined', ...refs };
  if (status === 'expired') return { kind: 'expired' };
  return { kind: 'pending', ...refs };
}

export default async function RivalsPage({ searchParams }: PageProps) {
  const { tab, callout } = await searchParams;
  const duoEnabled = isFlagEnabled('duo_queue');
  const calloutsEnabled = isFlagEnabled('callouts');
  const activeTab: RivalsTab = tab === 'duo' ? 'duo' : 'nemesis';

  const session = await auth();
  const db = getDb();
  const profile = session?.user?.id ? await getProfileByUserId(db, session.user.id) : null;
  const isClaimed = profile !== null && profile.kind === 'claimed';

  // Incoming call-out (WS20-T4): rendered above everything when the viewer arrives with a token —
  // for ghosts (routed through Save to accept) and claimed viewers alike.
  let incoming: ReactNode = null;
  if (calloutsEnabled && callout) {
    const preview = await getCalloutPreview(db, callout, now());
    incoming = <IncomingCalloutCard token={callout} isClaimed={isClaimed} initial={toIncomingState(preview)} />;
  }

  let body: ReactNode;
  if (!isClaimed || !profile) {
    body = (
      <div className="space-y-4" data-testid="rivals-save-gate">
        <ClaimEntry presentation="inline" enabledProviders={getEnabledAuthProviders()} />
      </div>
    );
  } else if (activeTab === 'duo') {
    body = (
      <div className="space-y-6" data-testid="rivals-duo-panel">
        <DuoRoom />
      </div>
    );
  } else {
    // Nemesis tab (claimed): the nemesis-week body + the WS20-T4 call-out surfaces. The grudge book
    // reuses `NemesisHistoryList` in `variant="grudges"` mode (it folds the same history entries
    // into one lifetime aggregate per rival), so only the history page is fetched here.
    const [candidates, acceptedViews, historyPage] = await Promise.all([
      calloutsEnabled ? getCalloutCandidates(db, profile.id) : Promise.resolve([]),
      calloutsEnabled ? getAcceptedCalloutViews(db, profile.id) : Promise.resolve([]),
      calloutsEnabled
        ? getNemesisHistoryPage(db, profile.id, { limit: NEMESIS_HISTORY_DEFAULT_LIMIT })
        : Promise.resolve(null),
    ]);
    body = (
      <div className="flex flex-1 flex-col space-y-8" data-testid="rivals-nemesis-panel">
        <NemesisRoom profile={profile} />
        {calloutsEnabled ? (
          <>
            <AcceptedCalloutCard views={acceptedViews} />
            <CalloutPanel candidates={candidates} />
            <section data-testid="grudge-book-section" className="space-y-3">
              <h2 className="text-lg font-bold">{calloutsCopy.grudgeHeading}</h2>
              <NemesisHistoryList entries={historyPage?.data ?? []} variant="grudges" viewerProfileId={profile.id} />
            </section>
          </>
        ) : null}
      </div>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col space-y-8 px-6 py-10">
      {incoming}
      <RivalsTabs activeTab={activeTab} duoEnabled={duoEnabled} />
      {body}
    </main>
  );
}
