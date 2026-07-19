/**
 * SW4-T2 · The Print-Shop restyle of the OG/card components (§2.1, D-SW1). Structural render
 * (renderToStaticMarkup — satori itself only runs at the route, which needs a DB); asserts the
 * paper palette + embedded brand faces are wired through. The font buffers are checked directly.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { OgCanvas, OgHeadline, OgPriceTag, OgStamp } from '@/lib/og/components';
import { loadDisplayFonts } from '@/lib/og/fonts';

describe('Print-Shop OG components (SW4-T2)', () => {
  it('renders on the paper ground with ink text, not the dark app bg', () => {
    const html = renderToStaticMarkup(
      <OgCanvas>
        <OgHeadline>Does the Fed cut rates?</OgHeadline>
      </OgCanvas>,
    );
    expect(html).toContain('#EFEBDD'); // printShop.ground
    expect(html).toContain('#1A1A1A'); // printShop.ink
    expect(html).not.toContain('#0B0B0D'); // never the dark app bg on a card
  });

  it('sets the headline in the Barlow display face, uppercased', () => {
    const html = renderToStaticMarkup(<OgHeadline>Called it</OgHeadline>);
    expect(html).toContain('Barlow Condensed');
    expect(html).toMatch(/text-transform:\s*uppercase/);
  });

  it('prints prices in the mono face as cents, never money', () => {
    const html = renderToStaticMarkup(<OgPriceTag side="yes" cents={63} />);
    expect(html).toContain('IBM Plex Mono');
    expect(html).toContain('63¢');
    expect(html).not.toMatch(/\$/);
  });

  it('uses the darkened on-paper win/loss inks for stamps', () => {
    expect(renderToStaticMarkup(<OgStamp variant="win" />)).toContain('#1D8A6B');
    expect(renderToStaticMarkup(<OgStamp variant="loss" />)).toContain('#C22B49');
  });
});

describe('embedded card fonts (SW4-T2)', () => {
  it('loads the four brand faces with non-empty buffers under the satori family names', () => {
    const fonts = loadDisplayFonts();
    expect(fonts.map((f) => `${f.name}:${f.weight}`).sort()).toEqual([
      'Barlow Condensed:500',
      'Barlow Condensed:700',
      'IBM Plex Mono:400',
      'IBM Plex Mono:600',
    ]);
    for (const f of fonts) expect(f.data.length).toBeGreaterThan(1000);
  });
});
