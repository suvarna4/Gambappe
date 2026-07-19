/**
 * D-SW9 / swipe plan §2.2 axis-order proof for the design-system components: in every
 * horizontally paired yes/no UI the first (left) axis child carries `data-side="no"`, pair
 * containers set `dir="ltr"` (left/right are visual gesture space, never mirrored by RTL),
 * and the YES crowd segment is right-anchored. Same `renderToStaticMarkup` pattern as
 * `reveal-motion.test.tsx` — no jsdom/@testing-library in this repo.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CrowdBar } from '../src/components/CrowdBar.js';
import { PriceTag } from '../src/components/PriceTag.js';

/** Every `data-side` value in the markup, in DOM order. */
function axisSides(html: string): string[] {
  return [...html.matchAll(/data-side="(no|yes)"/g)].map((m) => m[1]!);
}

describe('CrowdBar — axis order (D-SW9)', () => {
  const html = renderToStaticMarkup(
    <CrowdBar yesCount={7} noCount={3} yesLabel="Yes" noLabel="No" />,
  );

  it('renders NO before YES in both the label row and the bar segments', () => {
    expect(axisSides(html)).toEqual(['no', 'yes', 'no', 'yes']);
  });

  it('pins both axis rows to visual LTR so RTL locales cannot mirror gesture space', () => {
    expect(html.match(/dir="ltr"/g)).toHaveLength(2);
  });

  it('right-anchors the YES fill (justify-between pins the second segment to the right edge)', () => {
    expect(html).toContain('justify-between overflow-hidden');
  });

  it('keeps each side its own color: NO segment is side-b, YES segment side-a', () => {
    const noIdx = html.indexOf('data-side="no" class="bg-side-b');
    const yesIdx = html.indexOf('data-side="yes" class="bg-side-a');
    expect(noIdx).toBeGreaterThan(-1);
    expect(yesIdx).toBeGreaterThan(noIdx);
  });

  it('speaks the split in visual order too: aria-label lists NO first', () => {
    expect(html).toContain('aria-label="Crowd split: No 30%, Yes 70%"');
  });

  it('animated variant still carries both per-side fill targets (WS7-T3 contract intact)', () => {
    const animated = renderToStaticMarkup(
      <CrowdBar yesCount={7} noCount={3} yesLabel="Yes" noLabel="No" animated />,
    );
    expect(animated).toContain('--crowd-fill-target:30%');
    expect(animated).toContain('--crowd-fill-target:70%');
    expect(axisSides(animated)).toEqual(['no', 'yes', 'no', 'yes']);
  });
});

describe('PriceTag — data-side (D-SW9 pair-site proof hook)', () => {
  it('stamps its side on the root element', () => {
    expect(renderToStaticMarkup(<PriceTag side="no" label="No" yesProbability={0.63} />)).toContain(
      'data-side="no"',
    );
    expect(
      renderToStaticMarkup(<PriceTag side="yes" label="Yes" yesProbability={0.63} />),
    ).toContain('data-side="yes"');
  });
});
