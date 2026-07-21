import type { ReactNode } from 'react';
import Link from 'next/link';
import { isFlagEnabled } from '@receipts/core';
import { getProfileByUserId } from '@receipts/db';
import { auth } from '../../auth';
import { getDb } from '@/lib/stores';
import ClaimEntry from '@/components/claim/ClaimEntry';
import { NemesisRoom } from '../nemesis/NemesisRoom';
import { DuoRoom } from '../duo/DuoRoom';

/**
 * `/rivals` — the one Rivals room (journeys plan D-J6 / §3 route map / §5 WS17-T2): a segmented
 * control (Nemesis · Duo) over the two rival surfaces that previously lived only at `/nemesis` and
 * `/duo`. Those standalone routes keep working byte-for-behavior (deep links, share cards); this
 * hub reuses their extracted bodies — `NemesisRoom` and `DuoRoom` — rather than forking them
 * (journeys plan §0 "if a task says 'reuse X', reuse X").
 *
 * Tab selection is URL-driven (`?tab=nemesis|duo`, default nemesis) so a tab is a plain server
 * navigation — no client island needed for the control, and the active tab survives share/deep
 * links. The Duo segment is only shown when the `duo_queue` flag is on; `DuoRoom` carries its own
 * flag gate, so a forced `?tab=duo` with the flag off 404s exactly as a direct `/duo` hit does
 * (§5 seam note).
 *
 * Ghost / signed-out: instead of `/nemesis`'s `redirect('/claim')`, the hub renders the neutral
 * save-gate panel inline (the existing `ClaimEntry`, the same neutral gate `DuoHubClient` shows an
 * unclaimed visitor) — a ghost sees the gate, not a redirect (§5 AC). WS21-T1 restyles the gate
 * copy; this task does not block on it and does not touch `copy.ts` (§5 seam / §7 seam 2).
 *
 * Seam: does not touch `layout.tsx` (WS17-T1 owns the app shell / tab bar) — this page renders its
 * own `<main>`, same as every other route does today until WS17-T1 mounts the shell.
 */
export const dynamic = 'force-dynamic';

type RivalsTab = 'nemesis' | 'duo';

interface PageProps {
  searchParams: Promise<{ tab?: string }>;
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

export default async function RivalsPage({ searchParams }: PageProps) {
  const { tab } = await searchParams;
  const duoEnabled = isFlagEnabled('duo_queue');
  // Default tab is nemesis; `?tab=duo` selects duo. When the flag is off the Duo segment isn't
  // shown, and a forced `?tab=duo` still resolves the duo body below, where `DuoRoom`'s own gate
  // 404s it — matching a direct `/duo` hit exactly.
  const activeTab: RivalsTab = tab === 'duo' ? 'duo' : 'nemesis';

  const session = await auth();
  const db = getDb();
  const profile = session?.user?.id ? await getProfileByUserId(db, session.user.id) : null;
  const isClaimed = profile !== null && profile.kind === 'claimed';

  let body: ReactNode;
  if (!isClaimed || !profile) {
    // Neutral save-gate panel — the ghost/signed-out state renders inline instead of redirecting.
    body = (
      <div className="space-y-4" data-testid="rivals-save-gate">
        <ClaimEntry presentation="inline" />
      </div>
    );
  } else if (activeTab === 'duo') {
    body = (
      <div className="space-y-6" data-testid="rivals-duo-panel">
        <DuoRoom />
      </div>
    );
  } else {
    body = (
      <div className="flex flex-1 flex-col space-y-8" data-testid="rivals-nemesis-panel">
        <NemesisRoom profile={profile} />
      </div>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col space-y-8 px-6 py-10">
      <RivalsTabs activeTab={activeTab} duoEnabled={duoEnabled} />
      {body}
    </main>
  );
}
