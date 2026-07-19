/**
 * SW1-T3 · `ReceiptSlip` — pure presentational (repo pattern: `renderToStaticMarkup`). The
 * print/retract animation is a mount effect (not exercised here); undo interaction is covered
 * by the SW1-T5 Playwright suite.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { ReceiptSlip } from '@/components/ReceiptSlip';

const base = {
  sideLabel: 'CUTS',
  entryCents: 71,
  pickedAtLabel: '09:42 ET',
  serial: '№ 2026-07-19',
  sealedNote: 'CROWD HIDDEN UNTIL LOCK · 12:00 ET',
  onUndo: () => {},
};

describe('ReceiptSlip', () => {
  it('prints the stamped side + entry price and the timestamp/serial/sealed note', () => {
    const html = renderToStaticMarkup(<ReceiptSlip {...base} secondsLeft={54} />);
    expect(html).toContain('CUTS @ 71¢');
    expect(html).toContain('09:42 ET');
    expect(html).toContain('№ 2026-07-19');
    expect(html).toContain('CROWD HIDDEN UNTIL LOCK · 12:00 ET');
  });

  it('shows the printed undo link with the countdown while the window is open', () => {
    const html = renderToStaticMarkup(<ReceiptSlip {...base} secondsLeft={54} />);
    expect(html).toContain('data-testid="undo-pick"');
    expect(html).toContain('· 54s');
    expect(html).not.toContain('data-testid="undo-locked"');
  });

  it('renders a static "locked ✓" once the window has closed (secondsLeft null or 0)', () => {
    for (const secondsLeft of [null, 0] as const) {
      const html = renderToStaticMarkup(<ReceiptSlip {...base} secondsLeft={secondsLeft} />);
      expect(html).toContain('data-testid="undo-locked"');
      expect(html).toContain('locked ✓');
      expect(html).not.toContain('data-testid="undo-pick"');
    }
  });

  it('uses the handle in the header when provided, else a generic label', () => {
    expect(
      renderToStaticMarkup(<ReceiptSlip {...base} handle="Fox #4821" secondsLeft={9} />),
    ).toContain('Receipt — Fox #4821');
    expect(renderToStaticMarkup(<ReceiptSlip {...base} secondsLeft={9} />)).toContain('Your pick');
  });

  it('gives the stamp an accessible printed-receipt label and no money glyph (INV-8)', () => {
    const html = renderToStaticMarkup(<ReceiptSlip {...base} secondsLeft={9} />);
    expect(html).toContain('Receipt printed — CUTS at 71 cents.');
    expect(html).not.toMatch(/\$/);
  });

  it('renders printed (no off-screen transform) under reduced motion', () => {
    const html = renderToStaticMarkup(<ReceiptSlip {...base} secondsLeft={9} reducedMotion />);
    expect(html).toContain('translateY(0)');
    expect(html).not.toContain('translateY(112%)');
  });
});
