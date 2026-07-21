import type { Metadata } from 'next';
import Link from 'next/link';
import { nowMs, PRODUCT_NAME } from '@receipts/core';
import { SweatRow } from '@/components/SweatRow';
import { sweatCopy } from '@/lib/copy';
import { getSweatPositions } from '@/lib/sweat-feed';
import { getDb } from '@/lib/stores';
import { resolveViewerIdentity } from '@/lib/viewer-identity';

export const metadata: Metadata = {
  title: `${PRODUCT_NAME} — the sweat`,
  description: 'Everything you have riding, soonest to settle first.',
};

/**
 * `/sweat` — the Sweat room (journeys-plan §5 WS19-T2, D-J3): the viewer's open positions
 * (`pending` picks) by settle-time. Force-dynamic and viewer-scoped — it reads the viewer's own
 * picks via the ghost cookie (ghost) or the Auth.js session (claimed), so it is deliberately NOT
 * cached: no cookie ever fragments an ISR entry here (INV-10 applies to the public/ISR pages, not
 * this one). An anonymous visitor (no ghost, no session) has no positions and sees the empty
 * state — this page never mints a ghost (a GET render stays side-effect-free).
 */
export const dynamic = 'force-dynamic';

export default async function SweatPage() {
  const identity = await resolveViewerIdentity();
  const nowMsValue = nowMs();
  const positions =
    identity.kind === 'anonymous'
      ? []
      : await getSweatPositions(getDb(), identity.profile.id, nowMsValue);

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-6 py-10">
      <header className="mb-6 space-y-1">
        <p className="text-muted font-mono text-[10px] tracking-[0.22em] uppercase">
          {sweatCopy.eyebrow}
        </p>
        <h1 className="font-display text-2xl font-bold uppercase">{sweatCopy.heading}</h1>
        <p className="text-muted text-sm">{sweatCopy.intro}</p>
      </header>

      {positions.length === 0 ? (
        <div data-testid="sweat-empty" className="space-y-3 py-10 text-center">
          <p className="text-paper text-lg font-semibold">{sweatCopy.emptyTitle}</p>
          <p className="text-muted text-sm">{sweatCopy.emptyBody}</p>
          <Link
            href="/"
            data-testid="sweat-empty-cta"
            className="border-surface text-paper hover:border-paper/60 inline-block rounded border px-4 py-2 text-sm font-semibold transition-colors"
          >
            {sweatCopy.emptyCta}
          </Link>
        </div>
      ) : (
        <div data-testid="sweat-list" className="flex flex-col">
          {positions.map((position) => (
            <SweatRow key={position.pickId} position={position} />
          ))}
        </div>
      )}
    </main>
  );
}
