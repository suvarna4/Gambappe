/**
 * SW2-T3 — D-SW9 / swipe plan §2.2 axis-order proof across every touched surface: in every
 * horizontally paired yes/no UI, the FIRST axis child carries `data-side="no"` (NO/against is
 * visually left, YES/for visually right) and the pair container sets `dir="ltr"` so RTL
 * locales don't mirror gesture space. Same `renderToStaticMarkup` pattern as
 * `question-state-view.test.tsx` — no jsdom/@testing-library dependency in this repo.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { QuestionPublic } from '@receipts/core';
import type { QuestionRow } from '@receipts/db';
import { PickButtons } from '@/components/PickButtons';
import { QuestionStateView } from '@/components/QuestionStateView';
import { PlacementPickRow } from '@/app/placement/PlacementClient';
import { renderQuestionTemplate } from '@/lib/og/templates';

/** Every `data-side` value in the markup, in DOM order. */
function axisSides(html: string): string[] {
  return [...html.matchAll(/data-side="(no|yes)"/g)].map((m) => m[1]!);
}

const base: QuestionPublic = {
  id: '018f1e2b-0000-7000-8000-000000000001' as QuestionPublic['id'],
  slug: 'will-it-happen',
  kind: 'daily',
  status: 'open',
  question_date: '2026-07-19',
  headline: 'Will it happen?',
  blurb: null,
  yes_label: 'France',
  no_label: 'Brazil',
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

describe('PickButtons — axis order (D-SW9)', () => {
  const html = renderToStaticMarkup(
    <PickButtons yesLabel="France" noLabel="Brazil" ageGateRequired={false} onPick={() => {}} />,
  );

  it('renders the NO button first (visually left), YES second', () => {
    expect(axisSides(html)).toEqual(['no', 'yes']);
    expect(html.indexOf('data-testid="pick-no"')).toBeLessThan(
      html.indexOf('data-testid="pick-yes"'),
    );
  });

  it('keeps both §2.13.7 testids alive with their side labels and colors', () => {
    expect(html).toContain('data-testid="pick-no"');
    expect(html).toContain('data-testid="pick-yes"');
    expect(html.indexOf('Brazil')).toBeLessThan(html.indexOf('France'));
    // Colors stay attached to their sides — only position flips.
    expect(html).toMatch(/data-testid="pick-yes"[^>]*class="[^"]*border-side-a/);
    expect(html).toMatch(/data-testid="pick-no"[^>]*class="[^"]*border-side-b/);
  });

  it('pins the pair to visual LTR', () => {
    expect(html).toContain('dir="ltr"');
  });

  it('age gate: cancel (negative) is left, confirm (affirmative) right — §2.3.6 axis order', () => {
    const gate = renderToStaticMarkup(
      <PickButtons
        yesLabel="France"
        noLabel="Brazil"
        ageGateRequired
        onPick={() => {}}
        defaultPendingSide="yes"
      />,
    );
    expect(gate).toContain('data-testid="age-gate"');
    expect(axisSides(gate)).toEqual(['no', 'yes']);
    expect(gate.indexOf('data-testid="age-gate-cancel"')).toBeLessThan(
      gate.indexOf('data-testid="age-gate-confirm"'),
    );
    expect(gate).toContain('dir="ltr"');
  });
});

describe('QuestionStateView — axis order (D-SW9)', () => {
  it('open: the price row renders the NO PriceTag first, on an ltr row', () => {
    const html = renderToStaticMarkup(<QuestionStateView question={base} serverOffsetMs={0} />);
    expect(axisSides(html)).toEqual(['no', 'yes']);
    expect(html).toContain('dir="ltr"');
    // Both prices still render (mock erratum #1 fixed by flipping, not dropping).
    expect(html).toContain('63¢');
    expect(html).toContain('37¢');
  });

  it('locked: the crowd bar fills NO from the left edge', () => {
    const html = renderToStaticMarkup(
      <QuestionStateView
        question={{ ...base, status: 'locked', crowd: { yes: 70, no: 30, pct_yes: 70 } }}
        serverOffsetMs={0}
      />,
    );
    expect(axisSides(html)).toEqual(['no', 'yes', 'no', 'yes']);
  });

  it('revealed: the animated crowd bar keeps the same NO-first order', () => {
    const html = renderToStaticMarkup(
      <QuestionStateView
        question={{
          ...base,
          status: 'revealed',
          outcome: 'yes',
          crowd: { yes: 70, no: 30, pct_yes: 70 },
        }}
        serverOffsetMs={0}
      />,
    );
    expect(axisSides(html)).toEqual(['no', 'yes', 'no', 'yes']);
    expect(html).toContain('motion-safe:[animation:crowd-fill_500ms_ease-out_200ms_1_both]');
  });
});

describe('PlacementPickRow — axis order (D-SW9)', () => {
  const html = renderToStaticMarkup(
    <PlacementPickRow
      yesLabel="Over 60%"
      noLabel="Under 60%"
      disabled={false}
      onAnswer={() => {}}
    />,
  );

  it('renders the NO tap first (visually left), YES second, on an ltr row', () => {
    expect(axisSides(html)).toEqual(['no', 'yes']);
    expect(html.indexOf('Under 60%')).toBeLessThan(html.indexOf('Over 60%'));
    expect(html).toContain('dir="ltr"');
  });

  it('keeps side colors attached to their sides', () => {
    expect(html).toMatch(/data-side="yes"[^>]*class="bg-side-a/);
    expect(html).toMatch(/data-side="no"[^>]*class="bg-side-b/);
  });
});

describe('OG templates — axis order (D-SW9)', () => {
  const question = {
    id: '018f1e2b-0000-7000-8000-000000000002',
    slug: 'will-it-happen',
    headline: 'Will it happen?',
    yesLabel: 'France',
    noLabel: 'Brazil',
    crowdYesAtLock: 70,
    crowdNoAtLock: 30,
    outcome: 'yes',
  } as unknown as QuestionRow;

  it('result variant: OgCrowdBar renders NO segments/labels before YES', () => {
    const html = renderToStaticMarkup(
      renderQuestionTemplate({ question, yesPrice: 0.63, variant: 'result' }),
    );
    expect(axisSides(html)).toEqual(['no', 'yes', 'no', 'yes']);
    // NO fills from the left edge with its own color; YES sits right with its own.
    expect(html.indexOf('NO 30%')).toBeLessThan(html.indexOf('YES 70%'));
  });

  it('question variant: the side-pair listing is NO-first', () => {
    const html = renderToStaticMarkup(
      renderQuestionTemplate({ question, yesPrice: 0.63, variant: 'question' }),
    );
    expect(html).toContain('Brazil / France');
  });
});
