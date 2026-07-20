/**
 * SW10-T3(a) (wiring-gaps doc §4 SW10-T3): `PartnerLockedChip` — the sealed partner chip.
 * Sealed means existence + timing ONLY; this component has no prop for the partner's side and
 * therefore no "unsealed" render to test against (there isn't one).
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { PartnerLockedChip } from '@/components/duo/PartnerLockedChip';

describe('PartnerLockedChip', () => {
  it('renders the pinned glyph/LOCKED/hours-ago format', () => {
    const html = renderToStaticMarkup(
      <PartnerLockedChip
        partnerHandle="Dre P."
        pickedAtIso="2026-07-19T13:00:00Z"
        nowMsValue={Date.parse('2026-07-19T16:00:00Z')}
      />,
    );
    expect(html).toContain('data-testid="partner-locked-chip"');
    expect(html).toContain('▣ Dre P. LOCKED · 3h AGO');
  });

  it('never renders any market-side wording (there is no unsealed state)', () => {
    const html = renderToStaticMarkup(
      <PartnerLockedChip
        partnerHandle="Dre P."
        pickedAtIso="2026-07-19T13:00:00Z"
        nowMsValue={Date.parse('2026-07-19T16:00:00Z')}
      />,
    );
    // The component has no side prop at all — this just documents the contract mechanically:
    // the only two words this component can ever produce are pinned copy + the handle/hours.
    expect(html).not.toMatch(/\byes\b|\bno\b/i);
  });

  it('never leaks a money glyph (INV-8)', () => {
    const html = renderToStaticMarkup(
      <PartnerLockedChip partnerHandle="Dre P." pickedAtIso="2026-07-19T13:00:00Z" nowMsValue={Date.now()} />,
    );
    expect(html).not.toMatch(/\$/);
  });
});
