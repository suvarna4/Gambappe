/**
 * WS24-T1 · `FlapText` — the split-flap arrivals-board primitive (journeys-plan §5, STRETCH).
 * Pure presentational; `renderToStaticMarkup` (repo pattern, no jsdom). Asserts the per-character
 * cells, the split hairline, the sr-only accessible reading, and the motion-safe/reduced-motion
 * animation contract.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { FlapText } from '../src/components/FlapText.js';

describe('FlapText', () => {
  it('renders one cell per character, uppercased', () => {
    const html = renderToStaticMarkup(<FlapText>Live</FlapText>);
    const cells = html.match(/data-flap-cell="char"/g) ?? [];
    expect(cells).toHaveLength(4); // L I V E
    expect(html).toContain('>L<');
    expect(html).toContain('>V<');
    // Uppercased, never the lowercase source.
    expect(html).not.toContain('>i<');
  });

  it('marks space characters as their own (aria-hidden) cell so words keep their gaps', () => {
    const html = renderToStaticMarkup(<FlapText>A B</FlapText>);
    expect(html).toContain('data-flap-cell="space"');
    expect((html.match(/data-flap-cell="char"/g) ?? [])).toHaveLength(2);
  });

  it('carries the split hairline seam and dark-board tokens (paper ink on a bg cell)', () => {
    const html = renderToStaticMarkup(<FlapText>X</FlapText>);
    expect(html).toContain('bg-bg'); // cell surface
    expect(html).toContain('text-paper'); // cell ink (AA on the dark board)
    expect(html).toContain('bg-paper/20'); // the seam hairline
    expect(html).not.toContain('gold'); // never the win-reserved gold token
  });

  it('exposes a single sr-only accessible reading; the cells are aria-hidden', () => {
    const html = renderToStaticMarkup(<FlapText>LIVE</FlapText>);
    expect(html).toContain('sr-only');
    expect(html).toContain('>LIVE<');
    expect(html).toContain('aria-hidden="true"');
  });

  it('honours a label override for the accessible reading', () => {
    const html = renderToStaticMarkup(<FlapText label="settles November 2026">~NOV 2026</FlapText>);
    expect(html).toContain('settles November 2026');
  });

  it('applies the motion-safe flip-in only when animate is set (reduced-motion static otherwise)', () => {
    const still = renderToStaticMarkup(<FlapText>LIVE</FlapText>);
    expect(still).not.toContain('flap-tick');
    expect(still).not.toContain('animation-delay');

    const ticking = renderToStaticMarkup(<FlapText animate>LIVE</FlapText>);
    // Gated behind `motion-safe:` so `prefers-reduced-motion` never applies the animation.
    expect(ticking).toContain('motion-safe:[animation:flap-tick_420ms_ease-out_both]');
    // Cells stagger their flip.
    expect(ticking).toMatch(/animation-delay/);
  });
});
