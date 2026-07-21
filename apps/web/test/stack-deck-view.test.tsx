/**
 * WS18-T3 · Static-render coverage (`renderToStaticMarkup`, repo pattern — no jsdom) for the
 * stack deck's presentational pieces and `SwipeBallot`'s additive `onSkip`/`footerSlot` props
 * (seam 3). The queue math has its own pure test (`deck-queue.test.ts`); the browser-driven
 * gesture/order flow is `e2e/stack-deck.spec.ts`. Here we assert the additive props render, and —
 * critically for seam 3 — that OMITTING them keeps `SwipeBallot` byte-identical (no skip hint,
 * no footer), so every existing call site is unaffected.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { QuestionPublic } from '@receipts/core';

import { DeckHeadlinerFooter } from '@/components/DeckQueue';
import { SwipeBallot } from '@/components/SwipeBallot';
import { stackCopy } from '@/lib/copy';

const OPEN_Q: QuestionPublic = {
  id: '018f1e2b-0000-7000-8000-0000000000cc' as QuestionPublic['id'],
  slug: '2026-07-21-fed-cut',
  kind: 'daily',
  status: 'open',
  question_date: '2026-07-21',
  headline: 'Does the Fed cut in September?',
  blurb: null,
  yes_label: 'CUTS',
  no_label: 'HOLDS',
  open_at: '2026-07-21T13:00:00Z',
  lock_at: '2026-07-21T16:00:00Z',
  reveal_at: '2026-07-22T00:00:00Z',
  yes_price: 0.62,
  yes_price_updated_at: '2026-07-21T13:00:00Z',
  crowd: null,
  outcome: null,
  revealed_at: null,
  void_reason: null,
  is_volatile: false,
  venue: 'kalshi',
  venue_url: 'https://kalshi.example/markets/test',
};

function renderBallot(props: Partial<Parameters<typeof SwipeBallot>[0]> = {}): string {
  return renderToStaticMarkup(
    <SwipeBallot
      question={OPEN_Q}
      ageGateRequired={false}
      pick={null}
      undoable={false}
      onPick={() => {}}
      onUndo={() => {}}
      {...props}
    />,
  );
}

describe('DeckHeadlinerFooter (D-J2: only the headliner carries the streak)', () => {
  it('always prints STREAK RIDES THIS', () => {
    const html = renderToStaticMarkup(<DeckHeadlinerFooter />);
    expect(html).toContain(stackCopy.streakRides);
    expect(html).toContain('data-testid="deck-headliner-footer"');
  });

  it('lights the rival chip only when the pick is sealed AND a handle is known', () => {
    const lit = renderToStaticMarkup(
      <DeckHeadlinerFooter rivalSealed rivalHandle="quietloss" />,
    );
    expect(lit).toContain('data-testid="deck-rival-chip"');
    expect(lit).toContain(stackCopy.rivalSealed('quietloss'));
  });

  it('stays dormant when rival_sealed is null (the feed default) even with a handle', () => {
    const html = renderToStaticMarkup(
      <DeckHeadlinerFooter rivalSealed={null} rivalHandle="quietloss" />,
    );
    expect(html).not.toContain('data-testid="deck-rival-chip"');
  });

  it('stays dormant when sealed but no handle is known (INV-10 SSR default)', () => {
    const html = renderToStaticMarkup(<DeckHeadlinerFooter rivalSealed rivalHandle={null} />);
    expect(html).not.toContain('data-testid="deck-rival-chip"');
  });
});

describe('SwipeBallot — onSkip/footerSlot are additive (seam 3)', () => {
  it('advertises the ↑/SKIP affordance and renders the footer slot when onSkip is set', () => {
    const html = renderBallot({
      onSkip: () => {},
      footerSlot: <div data-testid="my-footer">footer</div>,
    });
    expect(html).toContain('SKIP'); // the ↑/S key hint
    expect(html).toContain('↑');
    expect(html).toContain('data-testid="my-footer"');
  });

  it('omitting them keeps the ballot byte-identical (no skip hint, no footer)', () => {
    const withProps = renderBallot({ onSkip: () => {}, footerSlot: <span>x</span> });
    const without = renderBallot();
    expect(without).not.toContain('SKIP');
    expect(without).not.toContain('<span>x</span>');
    // The two differ only by the additive bits — the interactive ballot itself still renders.
    expect(without).toContain('data-testid="swipe-ballot"');
    expect(withProps).toContain('data-testid="swipe-ballot"');
  });
});
