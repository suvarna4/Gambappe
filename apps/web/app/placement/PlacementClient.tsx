'use client';

/**
 * `/placement` client island (design doc §8.7, §9.2, §10.1 "client", §10.4, WS7-T10).
 *
 * The 5-tap flow: `GET /placement` loads 5 items (no outcomes); tapping a side POSTs
 * `{item_id, side}` to `POST /placement/answers` and the RESPONSE carries that item's own
 * mini reveal-loop result (historical outcome + crowd comparison, §8.7) — rendered immediately,
 * in place, before the user advances to the next item. This is deliberately not the WS7-T3
 * "reveal moment" choreography (§10.3: "Motion budget exists only here") — placement's mini
 * reveal is an instant state swap, no animated sequence.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Barcode, CrowdBar, PriceTag, Stamp, TicketCard } from '@receipts/ui';
import type { MarketSide } from '@receipts/core';
import { copy } from '@/lib/copy';
import {
  PlacementApiError,
  categoryLabel,
  crowdCountsFromPct,
  fetchPlacementItems,
  outcomeLabel,
  submitPlacementAnswer,
  tallyResults,
  trackPlacementEvent,
  type PlacementAnswerResult,
  type PlacementItem,
} from '@/lib/placement-client';

const PLACEMENT_PATH = '/placement';

type Phase = 'loading' | 'unauthenticated' | 'error' | 'active' | 'complete';

function ButtonLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="bg-side-a inline-flex min-h-11 items-center justify-center rounded px-4 py-2 text-sm font-semibold text-white"
    >
      {children}
    </Link>
  );
}

export default function PlacementClient() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [items, setItems] = useState<PlacementItem[]>([]);
  const [index, setIndex] = useState(0);
  const [reveal, setReveal] = useState<PlacementAnswerResult | null>(null);
  const [results, setResults] = useState<PlacementAnswerResult[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(() => {
    setPhase('loading');
    setLoadError(null);
    fetchPlacementItems()
      .then((fetched) => {
        setItems(fetched);
        setIndex(0);
        setReveal(null);
        setResults([]);
        if (fetched.length === 0) {
          setLoadError(copy.placement.emptyPoolMessage);
          setPhase('error');
          return;
        }
        trackPlacementEvent('placement_started');
        setPhase('active');
      })
      .catch((err: unknown) => {
        if (err instanceof PlacementApiError && err.code === 'UNAUTHENTICATED') {
          setPhase('unauthenticated');
          return;
        }
        setLoadError(err instanceof Error ? err.message : copy.placement.submitErrorFallback);
        setPhase('error');
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const currentItem = items[index] ?? null;

  function handleAnswer(side: MarketSide) {
    if (!currentItem || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    submitPlacementAnswer(currentItem.id, side)
      .then((result) => {
        setReveal(result);
        setResults((prev) => [...prev, result]);
      })
      .catch((err: unknown) => {
        setSubmitError(
          err instanceof PlacementApiError ? err.message : copy.placement.submitErrorFallback,
        );
      })
      .finally(() => setSubmitting(false));
  }

  function handleAdvance() {
    const nextIndex = index + 1;
    if (nextIndex >= items.length) {
      const { correct, total } = tallyResults(results);
      trackPlacementEvent('placement_completed', { correct, total });
      setPhase('complete');
      return;
    }
    setIndex(nextIndex);
    setReveal(null);
    setSubmitError(null);
  }

  if (phase === 'loading') {
    return (
      <main className="mx-auto max-w-xl px-4 py-10">
        <p className="text-muted text-sm" role="status">
          {copy.placement.loading}
        </p>
      </main>
    );
  }

  if (phase === 'unauthenticated') {
    // SPEC-GAP(ws7-t10): `GET /placement` is `ghost+` auth (§9.2 registry) and never lazily
    // mints — only `POST /placement/answers` does (§6.1.1's three named lazy-mint triggers).
    // So a visitor with no ghost cookie and no session yet gets UNAUTHENTICATED from the
    // very first load, before they can tap anything. The design doc frames placement as an
    // "on entry" flow (§8.7/PRD), which reads like it should work cold, but nothing in the
    // shipped WS4-T8 contract lets this GET mint one. This is the same gap WS4-T8's own route
    // comment already flags (not fixed here — see the RULES in this task's brief: flag, don't
    // patch someone else's shipped, tested endpoint). The UI's fallback is to point the visitor
    // at the one flow that DOES mint a ghost (today's question), then invite them back.
    return (
      <main className="mx-auto max-w-xl space-y-4 px-4 py-10">
        <h1 className="text-xl font-bold">{copy.placement.needsIdentityTitle}</h1>
        <p className="text-muted text-sm">{copy.placement.needsIdentityBody}</p>
        <ButtonLink href="/">{copy.placement.needsIdentityCta}</ButtonLink>
      </main>
    );
  }

  if (phase === 'error') {
    return (
      <main className="mx-auto max-w-xl space-y-4 px-4 py-10">
        <h1 className="text-xl font-bold">{copy.placement.loadErrorTitle}</h1>
        {loadError && (
          <p className="text-loss text-sm" role="alert">
            {loadError}
          </p>
        )}
        <button
          type="button"
          onClick={load}
          className="bg-side-a min-h-11 rounded px-4 py-2 text-sm font-semibold text-white"
        >
          {copy.placement.retry}
        </button>
      </main>
    );
  }

  if (phase === 'complete') {
    const { correct, total } = tallyResults(results);
    return (
      <main className="mx-auto max-w-xl space-y-6 px-4 py-10" data-testid="placement-complete">
        <h1 className="text-xl font-bold">{copy.placement.completeTitle}</h1>
        <p className="text-sm">{copy.placement.completeBody(correct, total)}</p>
        <ButtonLink href="/">{copy.placement.completeCta}</ButtonLink>
        <Barcode path={PLACEMENT_PATH} />
      </main>
    );
  }

  // phase === 'active'. `items.length === 0` is routed to the 'error' phase above, and `index`
  // never advances past `items.length - 1` (handleAdvance flips to 'complete' first), so this
  // is unreachable in practice — the null check only satisfies `noUncheckedIndexedAccess`.
  if (!currentItem) return null;

  const isLast = index === items.length - 1;

  return (
    <main className="mx-auto max-w-xl space-y-6 px-4 py-10" data-testid="placement-flow">
      <header className="space-y-1">
        <p className="text-muted font-mono text-xs uppercase" data-testid="placement-progress">
          {copy.placement.progressLabel(index + 1, items.length)}
        </p>
        <p className="text-muted text-sm">{copy.placement.intro}</p>
      </header>

      <TicketCard>
        <p className="text-muted text-xs font-semibold uppercase">
          {categoryLabel(currentItem.category)}
        </p>
        <p className="mt-1 font-mono text-base">{currentItem.title}</p>

        {!reveal ? (
          <div className="mt-4 flex gap-3">
            <button
              type="button"
              onClick={() => handleAnswer('yes')}
              disabled={submitting}
              className="bg-side-a min-h-11 flex-1 rounded px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              {currentItem.yes_label}
            </button>
            <button
              type="button"
              onClick={() => handleAnswer('no')}
              disabled={submitting}
              className="bg-side-b min-h-11 flex-1 rounded px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              {currentItem.no_label}
            </button>
          </div>
        ) : (
          <div className="mt-4 space-y-3" data-testid="placement-mini-reveal">
            <Stamp variant={reveal.correct ? 'win' : 'loss'} />
            <p className="text-ink text-sm">
              {copy.placement.yourCallPrefix} {outcomeLabel(currentItem, reveal.side)} —{' '}
              {copy.placement.resolvedPrefix} {outcomeLabel(currentItem, reveal.outcome)}
            </p>
            <PriceTag
              side={reveal.side}
              label={outcomeLabel(currentItem, reveal.side)}
              yesProbability={reveal.historical_yes_price}
            />
            <CrowdBar
              {...crowdCountsFromPct(reveal.historical_crowd_yes_pct)}
              yesLabel={currentItem.yes_label}
              noLabel={currentItem.no_label}
            />
            <p className="text-muted font-mono text-xs">
              {copy.placement.resolvedOnPrefix} {reveal.resolved_on}
            </p>
          </div>
        )}
      </TicketCard>

      {submitError && (
        <p className="text-loss text-sm" role="alert">
          {submitError}
        </p>
      )}

      {reveal && (
        <button
          type="button"
          onClick={handleAdvance}
          className="bg-side-a min-h-11 w-full rounded px-4 py-2 text-sm font-semibold text-white"
        >
          {isLast ? copy.placement.finishButton : copy.placement.nextButton}
        </button>
      )}

      <Barcode path={PLACEMENT_PATH} />
    </main>
  );
}
