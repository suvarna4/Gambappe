/**
 * SW5-T4 · `ReactionStamps` — preset matchup reactions (presentational; reactions-API wiring +
 * the one-per-day cap land in the DB-equipped session).
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { ReactionStamps } from '@/components/nemesis/ReactionStamps';

describe('ReactionStamps', () => {
  it('renders exactly the four preset stamps (preset-only, no free text — P1)', () => {
    const html = renderToStaticMarkup(<ReactionStamps onSelect={() => {}} />);
    for (const s of ['Sweating?', 'Lucky', 'Called it', 'Respect']) {
      expect(html).toContain(s);
    }
  });

  it('is interactive (buttons) when onSelect is given, marking the selected one pressed', () => {
    const html = renderToStaticMarkup(<ReactionStamps selected="Lucky" onSelect={() => {}} />);
    expect(html).toContain('<button');
    expect(html).toMatch(/data-testid="reaction-Lucky"[^>]*aria-pressed="true"/);
  });

  it('is read-only (no buttons) for ghosts when onSelect is omitted', () => {
    const html = renderToStaticMarkup(<ReactionStamps />);
    expect(html).not.toContain('<button');
    expect(html).toContain('data-testid="reaction-stamps"');
  });
});
