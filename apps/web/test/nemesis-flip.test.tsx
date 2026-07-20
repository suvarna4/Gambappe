/**
 * SW5-T1/SW10-T1 · `NemesisFlip` — the receipt's nemesis section (presentational; `RevealSequence`
 * wires it to live matchup data, mounted at reveal — §2.9, wiring-gaps doc §4 SW10-T1).
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { NemesisFlip } from '@/components/nemesis/NemesisFlip';

const base = {
  opponentHandle: 'Maria O.',
  opponentSide: 'no' as const,
  opponentSideLabel: 'HOLDS',
  opponentEntryCents: 27,
  narration: 'She is fading the room again. Tonight one of you eats this.',
  youWins: 1,
  opponentWins: 2,
  weekLabel: 'Week 30 · Day 2',
};

describe('NemesisFlip', () => {
  it('prints the sealed-until-reveal note, opponent stamp, narration, and tally', () => {
    const html = renderToStaticMarkup(<NemesisFlip {...base} />);
    expect(html).toContain('Maria O. · unsealed at reveal');
    expect(html).toContain('HOLDS @ 27¢');
    expect(html).toContain('Tonight one of you eats this.');
    expect(html).toContain('Week 30 · Day 2');
  });

  it('omits the narration line entirely when narration is null (SW10-T1 degrade rule)', () => {
    const html = renderToStaticMarkup(<NemesisFlip {...base} narration={null} />);
    expect(html).not.toContain('Tonight one of you eats this.');
    expect(html).toContain('HOLDS @ 27¢'); // rest of the block still renders
  });

  it('renders the tally viewer-relative (opponent ahead → names the opponent)', () => {
    expect(renderToStaticMarkup(<NemesisFlip {...base} />)).toContain('Maria O. leads 2–1');
    expect(renderToStaticMarkup(<NemesisFlip {...base} youWins={3} opponentWins={1} />)).toContain(
      'You lead 3–1',
    );
    expect(renderToStaticMarkup(<NemesisFlip {...base} youWins={2} opponentWins={2} />)).toContain(
      'Week even, 2–2',
    );
  });

  it('gives the opponent stamp an implied-probability a11y label, no money glyph (INV-8)', () => {
    const html = renderToStaticMarkup(<NemesisFlip {...base} />);
    expect(html).toContain('Maria O.: HOLDS at 27% implied');
    expect(html).not.toMatch(/\$/);
  });
});
