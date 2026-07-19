/**
 * SW1-T2 · `SwipeBallot` static structure (repo pattern: `renderToStaticMarkup`, node env).
 * Interaction (drag/arm/commit/undo/age-gate) is exercised end-to-end by the SW1-T5 Playwright
 * suite in a real browser; the pure gesture math is covered in `packages/ui/test/swipe.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { QuestionPublic } from '@receipts/core';

import { SwipeBallot } from '@/components/SwipeBallot';
import type { CachedPick } from '@/lib/pick-storage';

const base: QuestionPublic = {
  id: '018f1e2b-0000-7000-8000-000000000001' as QuestionPublic['id'],
  slug: 'will-it-happen',
  kind: 'daily',
  status: 'open',
  question_date: '2026-07-19',
  headline: 'Will it happen?',
  blurb: 'Some context.',
  yes_label: 'CUTS',
  no_label: 'HOLDS',
  open_at: '2026-07-19T13:00:00Z',
  lock_at: '2026-07-19T16:00:00Z',
  reveal_at: '2026-07-20T00:00:00Z',
  yes_price: 0.71,
  yes_price_updated_at: '2026-07-19T13:00:00Z',
  crowd: null,
  outcome: null,
  revealed_at: null,
  void_reason: null,
  is_volatile: false,
  venue: 'kalshi',
  venue_url: 'https://kalshi.example/markets/test',
};

const noop = () => {};

function render(props: Partial<Parameters<typeof SwipeBallot>[0]> = {}): string {
  return renderToStaticMarkup(
    <SwipeBallot
      question={base}
      ageGateRequired={false}
      pick={null}
      undoable={false}
      onPick={noop}
      onUndo={noop}
      {...props}
    />,
  );
}

describe('SwipeBallot — open state', () => {
  it('renders the interactive ballot with a labelled card group naming both sides', () => {
    const html = render();
    expect(html).toContain('data-testid="swipe-ballot"');
    expect(html).toContain('role="group"');
    expect(html).toContain('HOLDS and CUTS buttons below');
  });

  it('renders tap wells with the against well left of the for well (D-SW9 axis)', () => {
    const html = render();
    const noIdx = html.indexOf('data-testid="pick-no"');
    const yesIdx = html.indexOf('data-testid="pick-yes"');
    expect(noIdx).toBeGreaterThanOrEqual(0);
    expect(yesIdx).toBeGreaterThan(noIdx);
  });

  it('wells carry the venue side words and pair a glyph with each', () => {
    const html = render();
    expect(html).toContain('CUTS');
    expect(html).toContain('HOLDS');
    expect(html).toContain('✓');
    expect(html).toContain('✕');
  });

  it('shows the fallback hint arrows and no tint at rest', () => {
    const html = render();
    expect(html).toContain('data-testid="ballot-hints"');
    expect(html).not.toContain('data-testid="ballot-tint"');
  });

  it('renders the desktop keyboard hint (fine-pointer only), axis-ordered against·for (SW2-T4)', () => {
    const html = render();
    const hint = html.match(/data-testid="ballot-key-hint"[^>]*>(.*?)<\/p>/s)?.[1] ?? '';
    expect(hint).toContain('HOLDS');
    expect(hint).toContain('CUTS');
    expect(hint.indexOf('HOLDS')).toBeLessThan(hint.indexOf('CUTS'));
    expect(html).toContain('[@media(pointer:fine)]:block'); // hidden on touch
  });

  it('keeps the hints on a pre-armed deep link and renders regardless of pick history (SW2-T4)', () => {
    // arm forces the affordance even for a learned hand; at SSR pickCount is 0 so hints show
    // either way, but the arm path must not throw or drop them.
    const html = render({ arm: true });
    expect(html).toContain('data-testid="ballot-hints"');
  });
});

describe('SwipeBallot — receipt state', () => {
  // `SwipeBallot` computes `secondsLeft` from the real wall clock (`Date.now()` vs
  // `pick.undoUntilIso`), so a hardcoded past timestamp would eventually make the "shows undo
  // only while undoable" case below permanently fail once real time passed it — undoUntilIso is
  // computed relative to test-run time instead.
  const pick: CachedPick = {
    pickId: 'p1',
    side: 'yes',
    pickedAtIso: '2026-07-19T13:05:00Z',
    undoUntilIso: new Date(Date.now() + 60_000).toISOString(),
  };

  it('renders the receipt with the side label and cents when a pick exists', () => {
    const html = render({ pick });
    expect(html).toContain('data-testid="receipt-slip"');
    expect(html).toContain('CUTS @ 71¢');
    expect(html).not.toContain('data-testid="swipe-ballot"');
  });

  it('shows undo only while undoable', () => {
    expect(render({ pick, undoable: true })).toContain('data-testid="undo-pick"');
    expect(render({ pick, undoable: false })).not.toContain('data-testid="undo-pick"');
  });
});

describe('SwipeBallot — accessibility contract', () => {
  it('wells stay present even when disabled (a11y is not a tutorial that fades)', () => {
    const html = render({ disabled: true });
    expect(html).toContain('data-testid="pick-yes"');
    expect(html).toContain('data-testid="pick-no"');
    expect(html).toContain('disabled=""');
  });

  it('does not leak a money glyph anywhere (INV-8)', () => {
    expect(render()).not.toMatch(/\$/);
  });
});
