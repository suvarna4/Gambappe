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
  edgeGap: 11,
  dayResults: ['loss', 'win', 'loss', 'win', 'split'] as const,
};

describe('VerdictCard', () => {
  it('gives the loser the richer, data-derived line (P3)', () => {
    const html = renderToStaticMarkup(<VerdictCard {...base} outcome="lost" />);
    expect(html).toContain('Taken down');
    expect(html).toContain('2–3');
    // Apostrophe is HTML-escaped in SSR; match the distinctive tail.
    expect(html).toContain('edge beat yours by 11 points');
  });

  it('names the win outcome with its own line', () => {
    const html = renderToStaticMarkup(
      <VerdictCard {...base} outcome="won" youWins={3} opponentWins={2} />,
    );
    expect(html).toContain('You took the week');
    expect(html).toContain('out-edged Maria O.');
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
});
