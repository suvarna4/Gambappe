/**
 * `QuestionStateView` + `ViewerStrip` render coverage (§10.3 state table, §10.2/INV-10
 * viewer-free SSR proof). Uses `react-dom/server`'s `renderToStaticMarkup` directly rather
 * than a DOM testing library (no jsdom/@testing-library dependency exists in this repo yet,
 * §10.4: components are "pure/presentational (props in, DOM out)" by design, which is exactly
 * what makes a plain server-render string comparison a meaningful test here). Interactive
 * behavior (tapping buttons, the pick/undo round trip) is covered by `e2e/question-page.spec.ts`.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { QuestionPublic } from '@receipts/core';
import { QuestionStateView } from '@/components/QuestionStateView';
import { ViewerStrip } from '@/components/ViewerStrip';

const base: QuestionPublic = {
  id: '018f1e2b-0000-7000-8000-000000000001' as QuestionPublic['id'],
  slug: 'will-it-happen',
  kind: 'daily',
  status: 'open',
  question_date: '2026-07-19',
  headline: 'Will it happen?',
  blurb: 'Some context.',
  yes_label: 'Yes',
  no_label: 'No',
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

function renderState(question: QuestionPublic): string {
  return renderToStaticMarkup(<QuestionStateView question={question} serverOffsetMs={0} />);
}

describe('QuestionStateView — one render per §10.3 state', () => {
  it('scheduled', () => {
    const html = renderState({ ...base, status: 'scheduled' });
    expect(html).toContain('data-testid="question-state-scheduled"');
    expect(html).toContain('data-testid="question-scheduled"');
    expect(html).toContain('Opens');
  });

  it('open: shows both side prices, no crowd markup', () => {
    const html = renderState({ ...base, status: 'open' });
    expect(html).toContain('data-testid="question-open"');
    expect(html).toContain('63¢');
    expect(html).toContain('37¢');
    expect(html).not.toContain('role="img"'); // CrowdBar's aria role — must not render pre-lock
  });

  it('locked: renders the crowd split from the lock snapshot', () => {
    const html = renderState({
      ...base,
      status: 'locked',
      crowd: { yes: 70, no: 30, pct_yes: 70 },
    });
    expect(html).toContain('data-testid="question-locked"');
    expect(html).toContain('Yes 70%');
  });

  it('revealed: names the outcome label', () => {
    const html = renderState({
      ...base,
      status: 'revealed',
      outcome: 'yes',
      crowd: { yes: 70, no: 30, pct_yes: 70 },
    });
    expect(html).toContain('data-testid="question-revealed"');
    expect(html).toContain('Yes');
  });

  it('revealed: the outcome stamp and crowd bar carry the §10.3 reveal-moment motion classes', () => {
    const html = renderState({
      ...base,
      status: 'revealed',
      outcome: 'yes',
      crowd: { yes: 70, no: 30, pct_yes: 70 },
    });
    expect(html).toContain('data-testid="reveal-outcome-stamp"');
    expect(html).toContain('motion-safe:[animation:stamp-slam_450ms_ease-out_1]');
    expect(html).toContain('motion-safe:[animation:crowd-fill_500ms_ease-out_200ms_1_both]');
  });

  it('voided: shows the VOID stamp and streak-safe copy', () => {
    const html = renderState({ ...base, status: 'voided', void_reason: 'venue cancelled' });
    expect(html).toContain('data-testid="question-voided"');
    expect(html).toContain('VOID');
    expect(html).toContain('venue cancelled');
  });
});

describe('INV-10 — SSR is viewer-free', () => {
  it('QuestionStateView + ViewerStrip render byte-identical HTML across two independent renders of the same question (no hidden per-request/per-viewer variance)', () => {
    const question = { ...base, status: 'open' as const };
    const first = renderToStaticMarkup(
      <QuestionStateView
        question={question}
        serverOffsetMs={0}
        viewerSlot={<ViewerStrip question={question} />}
      />,
    );
    const second = renderToStaticMarkup(
      <QuestionStateView
        question={question}
        serverOffsetMs={0}
        viewerSlot={<ViewerStrip question={question} />}
      />,
    );
    expect(first).toBe(second);
  });

  it("ViewerStrip's server-rendered output is the reserved loading skeleton — never viewer data — regardless of the question's pick/identity-relevant state", () => {
    const html = renderToStaticMarkup(<ViewerStrip question={{ ...base, status: 'open' }} />);
    expect(html).toContain('data-testid="viewer-strip-loading"');
    // None of the identity-dependent markers this component CAN render post-hydration are
    // present in its initial server render.
    for (const marker of ['pick-yes', 'pick-no', 'undo-pick', 'viewer-strip-pick', 'age-gate']) {
      expect(html).not.toContain(marker);
    }
  });

  it("for a revealed question, ViewerStrip's server-rendered output is RevealSequence's own reserved loading skeleton — never the viewer's result/streak/percentile", () => {
    const html = renderToStaticMarkup(
      <ViewerStrip
        question={{ ...base, status: 'revealed', outcome: 'yes', crowd: { yes: 70, no: 30, pct_yes: 70 } }}
      />,
    );
    expect(html).toContain('data-testid="reveal-sequence-loading"');
    for (const marker of [
      'reveal-sequence-result',
      'reveal-sequence-no-pick',
      'reveal-sequence-percentile',
      'reveal-sequence-streak',
    ]) {
      expect(html).not.toContain(marker);
    }
  });

  it('the full page shell is identical whether or not a viewer identity would plausibly differ (simulated by rendering twice — nothing here reads request/cookie state)', () => {
    const question = {
      ...base,
      status: 'locked' as const,
      crowd: { yes: 40, no: 60, pct_yes: 40 },
    };
    const renderOnce = () =>
      renderToStaticMarkup(
        <QuestionStateView
          question={question}
          serverOffsetMs={0}
          viewerSlot={<ViewerStrip question={question} />}
        />,
      );
    expect(renderOnce()).toBe(renderOnce());
  });
});
