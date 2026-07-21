/**
 * SW2-T1 · The deck stage + its flag-gated wiring into `QuestionStateView`. Static structure via
 * `renderToStaticMarkup` (repo pattern); the INV-10 byte-identical / dual-render proof for the
 * flag-off path lives in `question-state-view.test.tsx` and stays green because `swipeBallot`
 * defaults false.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { QuestionPublic } from '@receipts/core';

import { DeckStage } from '@/components/DeckStage';
import { QuestionStateView } from '@/components/QuestionStateView';

const base: QuestionPublic = {
  id: '018f1e2b-0000-7000-8000-000000000001' as QuestionPublic['id'],
  slug: 'will-it-happen',
  kind: 'daily',
  status: 'open',
  question_date: '2026-07-19',
  headline: 'Will it happen?',
  blurb: null,
  yes_label: 'CUTS',
  no_label: 'HOLDS',
  open_at: '2026-07-19T13:00:00Z',
  lock_at: '2026-07-19T16:00:00Z',
  reveal_at: '2026-07-20T00:00:00Z',
  yes_price: 0.63,
  yes_price_updated_at: '2026-07-19T13:00:00Z',
  crowd: null,
  outcome: null,
  revealed_at: null,
  void_reason: null,
  is_volatile: false,
  venue: 'kalshi',
  venue_url: 'https://kalshi.example/markets/test',
};

describe('DeckStage', () => {
  it('renders the against rail left of the for rail (D-SW9 axis) and pins dir=ltr', () => {
    const html = renderToStaticMarkup(
      <DeckStage question={base} viewerSlot={<div data-testid="slot" />} />,
    );
    const againstIdx = html.indexOf('data-testid="rail-against"');
    const forIdx = html.indexOf('data-testid="rail-for"');
    expect(againstIdx).toBeGreaterThanOrEqual(0);
    expect(forIdx).toBeGreaterThan(againstIdx);
    expect(html).toContain('dir="ltr"');
    expect(html).toContain('data-testid="slot"');
  });

  it('labels the rails with the venue side words', () => {
    const html = renderToStaticMarkup(<DeckStage question={base} viewerSlot={null} />);
    expect(html).toContain('HOLDS');
    expect(html).toContain('CUTS');
  });

  // Design-diff audit: pins the rail/stage measurements the mockup's own `.rail-l`/`.rail-r`
  // (9px font, 26px width, scaled ×1.4) and `.scr` (no outer page chrome to stretch into, hence
  // `min-h-[70dvh]` as the /dev/ui gallery's floor) call for — a regression back to the
  // component's original pre-audit sizing wouldn't be caught by anything else in this suite.
  it('sizes the rails and stage to the mockup\'s own proportions (×1.4), not their original pre-audit sizing', () => {
    const html = renderToStaticMarkup(<DeckStage question={base} viewerSlot={null} />);
    expect(html).toContain('text-[13px]'); // .rail-l/.rail-r font-size 9px × 1.4
    expect(html).toContain('min-h-[70dvh]');
  });

  // Design-diff audit: the mockup's own `.rail-l`/`.rail-r` are `position:absolute` against
  // `.stage`, which starts only after `.topbar` — the rail tint never reaches the topbar row. An
  // earlier pass scoped the rails' `absolute inset-y-0` to the whole deck-stage container
  // (starting at y=0, behind the topbar) instead, so at low opacity the tint read as a dead zone
  // at the very top rather than a clean band starting right at the topbar's edge — caught by a
  // user screenshot comparison, not this suite. This pins the rail markup strictly after the
  // topbar's own closing tag so a regression back to the old (wrong) scope fails here too.
  it('scopes the rails to the stage wrapper that starts after the topbar, not the whole deck', () => {
    const html = renderToStaticMarkup(<DeckStage question={base} viewerSlot={null} />);
    // `DeckTopbar`'s own closing content ("Today</span>") must come strictly before the rail
    // markup — the rail's `absolute inset-y-0` is scoped to a wrapper that starts immediately
    // after `DeckTopbar`, not the whole deck-stage root, so it can never span behind the topbar.
    const topbarCloseIdx = html.indexOf('Today</span>');
    const railIdx = html.indexOf('data-testid="rail-against"');
    expect(topbarCloseIdx).toBeGreaterThan(0);
    expect(railIdx).toBeGreaterThan(topbarCloseIdx);
  });

  // Design-diff audit: the mockup's `.wells` is a sibling AFTER `.stage` (which is `flex:1`), so
  // it naturally sits flush against `.scr`'s bottom edge — an earlier pass centered the card AND
  // wells together as one shrink-wrapped block, leaving a large unwanted gap below the wells
  // instead. `pb-[17px]` (the mockup's own `.wells{padding:0 14px 12px}` bottom inset × 1.4) on
  // the card column, with no top padding (centering alone gives the vertical breathing room),
  // is what pins the wells to the true bottom now.
  it('gives the card column a bottom inset matching the mockup\'s own .wells padding, not a symmetric one', () => {
    const html = renderToStaticMarkup(<DeckStage question={base} viewerSlot={null} />);
    expect(html).toContain('pb-[17px]');
    expect(html).not.toContain('py-8');
  });

  it('renders the persistent topbar and threads the streak slot into it, empty when omitted', () => {
    const withSlot = renderToStaticMarkup(
      <DeckStage
        question={base}
        viewerSlot={null}
        streakSlot={<span data-testid="streak-slot">6</span>}
      />,
    );
    expect(withSlot).toContain('Today');
    expect(withSlot).toContain('data-testid="streak-slot"');

    const withoutSlot = renderToStaticMarkup(<DeckStage question={base} viewerSlot={null} />);
    expect(withoutSlot).toContain('Today');
    expect(withoutSlot).not.toContain('data-testid="streak-slot"');
  });
});

describe('QuestionStateView — swipe_ballot flag', () => {
  it('renders the deck stage for the open state when the flag is on', () => {
    const html = renderToStaticMarkup(
      <QuestionStateView
        question={base}
        serverOffsetMs={0}
        swipeBallot
        viewerSlot={<div data-testid="viewer" />}
      />,
    );
    expect(html).toContain('data-testid="deck-stage"');
    expect(html).toContain('data-testid="viewer"');
    // The ticket price-tag block is replaced by the deck for open.
    expect(html).not.toContain('data-testid="question-open"');
  });

  it('keeps the ticket layout for the open state when the flag is off (unchanged)', () => {
    const html = renderToStaticMarkup(
      <QuestionStateView question={base} serverOffsetMs={0} viewerSlot={null} />,
    );
    expect(html).toContain('data-testid="question-open"');
    expect(html).not.toContain('data-testid="deck-stage"');
  });

  it('renders non-open states on the deck stage too, without the open-state rails (SW2-T2)', () => {
    // scheduled: deck-styled, keeps its state testid, but no gesture rails (that's the open ballot).
    const scheduled = renderToStaticMarkup(
      <QuestionStateView
        question={{ ...base, status: 'scheduled' }}
        serverOffsetMs={0}
        swipeBallot
        viewerSlot={null}
      />,
    );
    expect(scheduled).toContain('data-testid="question-scheduled"');
    expect(scheduled).not.toContain('data-testid="deck-stage"');
    expect(scheduled).not.toContain('data-testid="rail-against"');
  });

  it('shows the post-lock crowd split on the deck for the locked state (§9.3 snapshot only)', () => {
    const locked = renderToStaticMarkup(
      <QuestionStateView
        question={{ ...base, status: 'locked', crowd: { yes: 64, no: 36, pct_yes: 64 } }}
        serverOffsetMs={0}
        swipeBallot
        viewerSlot={null}
      />,
    );
    expect(locked).toContain('data-testid="question-locked"');
    expect(locked).toContain('role="img"'); // CrowdBar
    expect(locked).toContain('64%');
  });

  it('never leaks a crowd split on the deck while open (§9.3)', () => {
    const open = renderToStaticMarkup(
      <QuestionStateView question={base} serverOffsetMs={0} swipeBallot viewerSlot={null} />,
    );
    expect(open).not.toContain('role="img"');
  });

  it('deck-styles the voided state with the void stamp + explainer', () => {
    const voided = renderToStaticMarkup(
      <QuestionStateView
        question={{ ...base, status: 'voided', void_reason: 'Venue voided the market.' }}
        serverOffsetMs={0}
        swipeBallot
        viewerSlot={null}
      />,
    );
    expect(voided).toContain('data-testid="question-voided"');
    expect(voided).toContain('VOID');
  });

  it('threads the streak slot into the non-open deck topbar too, so it never flickers between states', () => {
    const html = renderToStaticMarkup(
      <QuestionStateView
        question={{ ...base, status: 'scheduled' }}
        serverOffsetMs={0}
        swipeBallot
        viewerSlot={null}
        streakSlot={<span data-testid="streak-slot">6</span>}
      />,
    );
    expect(html).toContain('Today');
    expect(html).toContain('data-testid="streak-slot"');
  });
});
