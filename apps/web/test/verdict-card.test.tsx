/**
 * SW5-T2 · `VerdictCard` — the Friday nemesis verdict + rematch-by-swipe controls (presentational;
 * the SwipeBallot verdict variant + rematch API wiring land in the DB-equipped session).
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { VerdictCard } from '@/components/nemesis/VerdictCard';

const base = {
  opponentHandle: 'Maria O.',
  youWins: 2,
  opponentWins: 3,
  scoreMargin: 1,
  dayResults: ['loss', 'win', 'loss', 'win', 'neutral'] as const,
};

describe('VerdictCard', () => {
  it('gives the loser the richer, data-derived line (P3)', () => {
    const html = renderToStaticMarkup(<VerdictCard {...base} outcome="lost" />);
    expect(html).toContain('Taken down');
    expect(html).toContain('2–3');
    expect(html).toContain('Maria O. closed it out 1 clear');
  });

  it('names the win outcome with its own line', () => {
    const html = renderToStaticMarkup(
      <VerdictCard {...base} outcome="won" youWins={3} opponentWins={2} />,
    );
    expect(html).toContain('You took the week');
    expect(html).toContain('You closed it out 1 clear of Maria O.');
  });

  it('never asserts "edge" facts on either card (SW10-T2 — the history entry has no edge data)', () => {
    const loser = renderToStaticMarkup(<VerdictCard {...base} outcome="lost" />);
    const winner = renderToStaticMarkup(<VerdictCard {...base} outcome="won" />);
    expect(loser.toLowerCase()).not.toContain('edge');
    expect(winner.toLowerCase()).not.toContain('edge');
  });

  it('orders rematch-by-swipe new-fate-left / run-it-back-right (affirmative right, D-SW9)', () => {
    const html = renderToStaticMarkup(
      <VerdictCard {...base} outcome="lost" onNewFate={() => {}} onRunItBack={() => {}} />,
    );
    const newFateIdx = html.indexOf('data-testid="verdict-new-fate"');
    const runBackIdx = html.indexOf('data-testid="verdict-run-it-back"');
    expect(newFateIdx).toBeGreaterThanOrEqual(0);
    expect(runBackIdx).toBeGreaterThan(newFateIdx);
  });

  it('renders a static spectator card (no buttons) without handlers', () => {
    const html = renderToStaticMarkup(<VerdictCard {...base} outcome="lost" />);
    expect(html).not.toContain('<button');
  });

  it('shares one template between the winner and loser variants — same markup skeleton, only text differs', () => {
    const loser = renderToStaticMarkup(<VerdictCard {...base} outcome="lost" />);
    const winner = renderToStaticMarkup(<VerdictCard {...base} outcome="won" />);
    // Normalize away the one attribute value that's supposed to differ (`data-outcome`) and every
    // text node, leaving just the tag/attribute skeleton. If winner/loser were copy-pasted into
    // separate markup instead of one component branching on `outcome`, this would diverge.
    const skeleton = (html: string) =>
      html.replace(/data-outcome="[^"]*"/g, 'data-outcome="X"').replace(/>[^<]+</g, '><');
    expect(skeleton(loser)).toEqual(skeleton(winner));
  });
});
