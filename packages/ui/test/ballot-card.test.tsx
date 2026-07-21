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

  // Design-diff audit: an earlier pass shipped this card with its ORIGINAL, pre-mockup-audit
  // sizing untouched (only the new DeckTopbar got scaled) — nothing in this suite caught it
  // before manual user review did. These pin the mockup-derived values (`docs/mockups/
  // swipe-ux.html`'s `.card`/`.qh`/`.perf`, scaled ×1.4 — see this file's own header) so a
  // regression back to the unscaled originals (e.g. `text-2xl`/`h-1.5`/no aspect ratio) fails
  // the suite instead of needing another round of manual screenshot comparison.
  it('sizes the card via the mockup\'s own 196:300 ratio, not a content-shrunk box', () => {
    const html = renderToStaticMarkup(<BallotCard {...base} />);
    expect(html).toContain('aspect-[98/150]');
  });

  it('scales the headline and eyebrow text to the mockup\'s own proportions (×1.4), not their original pre-audit sizing', () => {
    const html = renderToStaticMarkup(<BallotCard {...base} />);
    expect(html).toContain('text-[32px]'); // .qh 22.5px × 1.4
    expect(html).toContain('text-[12px]'); // .qcat 8.5px × 1.4
    expect(html).not.toContain('text-2xl');
  });

  it('punches the perforation at the mockup\'s own size and softness, not a narrower/harder-edged guess', () => {
    const html = renderToStaticMarkup(<BallotCard {...base} />);
    expect(html).toMatch(/40%,\s*transparent 46%/); // .perf gradient falloff, not the old 42%
    expect(html).toContain('14px 14px'); // .perf background-size 10px × 1.4
  });

  it('colors the whole price chip by side and sizes its lines to the mockup\'s own inherited line-height, not the app\'s default', () => {
    const html = renderToStaticMarkup(<BallotCard {...base} />);
    // .pt.yes{color:#1d4fa8} / .pt.no{color:#b34d0a} — the whole chip's text, not just the border.
    expect(html).toContain('text-[#1d4fa8]');
    expect(html).toContain('text-[#b34d0a]');
    // Design-diff audit: mockup's html/body sets line-height:1.6 and nothing on `.pt .l`/`.pt .v`
    // overrides it; this app's own global line-height (1.5) silently shrank the chip below the
    // mockup's own proportions until these were pinned explicitly — read by a user as "the
    // stamps appear to be taller [in the mockup]".
    expect(html).toContain('leading-[1.6]');
    // .pt .v{margin-top:1px} × 1.4.
    expect(html).toContain('mt-[1.4px]');
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
