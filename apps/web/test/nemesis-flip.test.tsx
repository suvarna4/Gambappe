/**
 * SW5-T1 · `NemesisFlip` — the receipt's nemesis section (presentational; ViewerStrip wires it
 * to live matchup data in the DB-equipped session, mounting it only after the viewer's pick so
 * the opponent's side is never fetched early — §2.9).
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
  it('prints the sealed-until-lock note, opponent stamp, narration, and tally', () => {
    const html = renderToStaticMarkup(<NemesisFlip {...base} />);
    expect(html).toContain('Maria O. · unsealed when you locked');
    expect(html).toContain('HOLDS @ 27¢');
    expect(html).toContain('Tonight one of you eats this.');
    expect(html).toContain('Week 30 · Day 2');
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
