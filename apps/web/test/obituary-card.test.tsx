/**
 * SW4-T1 · `ObituaryCard` — the busted-streak artifact (P3). Pure presentational; the OG variant
 * (actions omitted) shares this layout in SW4-T2.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { ObituaryCard } from '@/components/ObituaryCard';

const base = {
  days: 11,
  startLabel: 'Jul 08',
  endLabel: 'Jul 19',
  facts: [{ text: '3 longshots called' }, { text: '1 freeze spent' }],
  sideLabel: 'HOLDS',
  entryCents: 29,
};

describe('ObituaryCard', () => {
  it('writes the streak obituary from data: title, dates, cause of death, RIP', () => {
    const html = renderToStaticMarkup(<ObituaryCard {...base} />);
    expect(html).toContain('Here lies a 11-day streak.');
    expect(html).toContain('b. Jul 08 — d. Jul 19');
    expect(html).toContain('Died holding HOLDS @ 29¢.');
    expect(html).toContain('RIP 11');
    expect(html).toContain('Busted');
  });

  it('lists the survived facts', () => {
    const html = renderToStaticMarkup(<ObituaryCard {...base} />);
    expect(html).toContain('3 longshots called');
    expect(html).toContain('1 freeze spent');
  });

  it('renders the static artifact (no buttons) when no actions are given — the OG variant', () => {
    const html = renderToStaticMarkup(<ObituaryCard {...base} />);
    expect(html).not.toContain('data-testid="obituary-bury"');
    expect(html).not.toContain('data-testid="obituary-share"');
    expect(html).not.toContain('<button');
  });

  it('orders the actions bury-left / share-right (axis rule) when interactive', () => {
    const html = renderToStaticMarkup(
      <ObituaryCard {...base} onBury={() => {}} onShare={() => {}} />,
    );
    const buryIdx = html.indexOf('data-testid="obituary-bury"');
    const shareIdx = html.indexOf('data-testid="obituary-share"');
    expect(buryIdx).toBeGreaterThanOrEqual(0);
    expect(shareIdx).toBeGreaterThan(buryIdx);
    // Apostrophe is HTML-escaped in SSR output, so match around it (the consolation line).
    expect(html).toContain('Streak 0.');
    expect(html).toContain('is, eventually.');
  });

  it('never leaks a money glyph (INV-8) and never references real death', () => {
    const html = renderToStaticMarkup(
      <ObituaryCard {...base} onBury={() => {}} onShare={() => {}} />,
    );
    expect(html).not.toMatch(/\$/);
    expect(html.toLowerCase()).not.toMatch(/\b(death|died of|funeral|grave)\b/);
  });
});
