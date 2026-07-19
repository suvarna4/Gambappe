/**
 * SW1-T1 · `BallotCard` — pure presentational. Uses `renderToStaticMarkup` (repo pattern,
 * no jsdom). Asserts the side-axis rule (§2.2), the display-face headline, and printed cents.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { BallotCard, UnderCard } from '../src/components/BallotCard.js';

const base = {
  eyebrow: 'ECON · DAILY',
  serial: '№ 212',
  headline: 'Does the Fed cut rates in September?',
  yesLabel: 'CUTS',
  noLabel: 'HOLDS',
  yesProbability: 0.71,
  venue: 'KALSHI · LIVE',
  lockLabel: 'LOCKS 12:00 ET',
};

describe('BallotCard', () => {
  it('renders the NO/against chip strictly before the YES/for chip (D-SW9 axis rule)', () => {
    const html = renderToStaticMarkup(<BallotCard {...base} />);
    const noIdx = html.indexOf('data-side="no"');
    const yesIdx = html.indexOf('data-side="yes"');
    expect(noIdx).toBeGreaterThanOrEqual(0);
    expect(yesIdx).toBeGreaterThan(noIdx);
  });

  it('wraps the price row in dir="ltr" so RTL cannot mirror the gesture semantics', () => {
    const html = renderToStaticMarkup(<BallotCard {...base} />);
    expect(html).toContain('dir="ltr"');
  });

  it('sets the headline in the display face', () => {
    const html = renderToStaticMarkup(<BallotCard {...base} />);
    expect(html).toContain('font-display');
    expect(html).toContain('Does the Fed cut rates in September?');
  });

  it('prints each side in cents-of-probability (71¢ / 29¢), never a money amount', () => {
    const html = renderToStaticMarkup(<BallotCard {...base} />);
    expect(html).toContain('71¢');
    expect(html).toContain('29¢');
    expect(html).not.toMatch(/\$/);
  });

  it('gives the price chips accessible implied-probability labels, not the ¢ glyph alone', () => {
    const html = renderToStaticMarkup(<BallotCard {...base} />);
    expect(html).toContain('CUTS: 71% implied');
    expect(html).toContain('HOLDS: 29% implied');
  });

  it('renders the overlay slot when provided', () => {
    const html = renderToStaticMarkup(
      <BallotCard {...base} overlay={<span data-testid="stamp-preview">CUTS @ 71¢</span>} />,
    );
    expect(html).toContain('data-testid="stamp-preview"');
  });

  it('carries the eyebrow, serial, venue and lock label', () => {
    const html = renderToStaticMarkup(<BallotCard {...base} />);
    for (const s of ['ECON · DAILY', '№ 212', 'KALSHI · LIVE', 'LOCKS 12:00 ET']) {
      expect(html).toContain(s);
    }
  });
});

describe('UnderCard', () => {
  it('is aria-hidden and shows its label when given one', () => {
    const html = renderToStaticMarkup(<UnderCard label="TOMORROW · opens 9:00 ET" />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('TOMORROW · opens 9:00 ET');
  });

  it('renders a blank slip with no label', () => {
    const html = renderToStaticMarkup(<UnderCard />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('TOMORROW');
  });
});
