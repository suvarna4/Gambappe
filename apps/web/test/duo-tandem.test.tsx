/**
 * SW5-T3 · `DuoTandem` — the duo shared-deck tandem line (presentational). Wired to live duo
 * series data in the DB-equipped session; mounted only after the viewer's pick (§2.9).
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { DuoTandem } from '@/components/duo/DuoTandem';

const base = {
  viewerSideLabel: 'SCORES',
  viewerSide: 'yes' as const,
  partnerHandle: 'Dre P.',
  partnerSideLabel: 'BLANKS',
  partnerSide: 'no' as const,
};

describe('DuoTandem', () => {
  it('shows both stamps and calls a SPLIT when the sides differ', () => {
    const html = renderToStaticMarkup(<DuoTandem {...base} />);
    expect(html).toContain('You: SCORES');
    expect(html).toContain('Dre P.: BLANKS');
    expect(html).toContain('Split — one of you is wrong');
    expect(html).toContain('data-matched="false"');
  });

  it('calls a MATCH when both took the same side', () => {
    const html = renderToStaticMarkup(
      <DuoTandem {...base} partnerSide="yes" partnerSideLabel="SCORES" />,
    );
    expect(html).toContain('Matched');
    expect(html).toContain('data-matched="true"');
    expect(html).not.toContain('Split — one of you is wrong');
  });

  it('never leaks a money glyph (INV-8)', () => {
    expect(renderToStaticMarkup(<DuoTandem {...base} />)).not.toMatch(/\$/);
  });

  /** SW10-T3(b) AC (wiring-gaps doc §4 SW10-T3): "SPLIT renders in gold mono (already
   * implemented in DuoTandem.tsx — verify the AC, don't re-derive)". */
  it('renders the SPLIT verdict in font-mono with the pinned gold ink (#6b5200)', () => {
    const html = renderToStaticMarkup(<DuoTandem {...base} />);
    const verdictMatch = html.match(/data-testid="tandem-verdict"[^>]*class="([^"]*)"/);
    expect(verdictMatch).not.toBeNull();
    const verdictClass = verdictMatch![1]!;
    expect(verdictClass).toContain('font-mono');
    expect(verdictClass).toContain('text-[#6b5200]');
    expect(html).toContain('data-matched="false"');
  });

  it('renders the MATCHED verdict in font-mono with a different (non-gold) ink', () => {
    const html = renderToStaticMarkup(<DuoTandem {...base} partnerSide="yes" partnerSideLabel="SCORES" />);
    const verdictMatch = html.match(/data-testid="tandem-verdict"[^>]*class="([^"]*)"/);
    expect(verdictMatch).not.toBeNull();
    const verdictClass = verdictMatch![1]!;
    expect(verdictClass).toContain('font-mono');
    expect(verdictClass).not.toContain('text-[#6b5200]');
  });
});
