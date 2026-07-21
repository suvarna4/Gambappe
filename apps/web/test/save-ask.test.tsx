/**
 * WS21-T2 · The ambient Save asks (journeys plan §5, D-J8). Node-env static-markup assertions (repo
 * pattern, mirrors `app-shell.test.tsx`). Pins the ACs:
 *  - the ask components carry NO gold / foil / win ink (gold is for wins, D-J8) — asserted on the
 *    rendered classnames, mirroring `app-shell.test.tsx`'s no-gold assertion;
 *  - the Save CHIP appears only when there's value to lose (a ghost with a streak or ≥1 pick), links
 *    to `/claim?next={path}`, and is one word;
 *  - the `/you` save ROW renders for a ghost and disappears once claimed.
 * The 1/day dismissal-persistence lives in `claim-prompt-engine.test.ts` (the shared marker).
 */
import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  } & Record<string, unknown>) => createElement('a', { href, ...rest }, children),
}));

// SaveChip reads the current path for the `?next=` return; SaveRow/SaveChip read the value signal.
let mockPathname = '/rivals';
vi.mock('next/navigation', () => ({ usePathname: () => mockPathname }));

// Partial-mock the value hook so static render sees a concrete status (the real hook fetches /me in
// an effect that never runs under renderToStaticMarkup). `hasSaveValue` stays the REAL function.
import type * as SaveStatusModule from '@/lib/save-status';
type SaveStatus = SaveStatusModule.SaveStatus;
let mockStatus: SaveStatus | null = null;
vi.mock('@/lib/save-status', async (importOriginal) => {
  const actual = await importOriginal<typeof SaveStatusModule>();
  return { ...actual, useSaveStatus: () => mockStatus };
});

import { SaveAskCard } from '@/components/save/SaveAskCard';
import { SaveChip } from '@/components/save/SaveChip';
import { SaveRow } from '@/components/save/SaveRow';
import { CLAIM_NUDGE_COPY, CLAIM_PROMPT_CTA } from '@/lib/copy';

/** Every rendered Save ask must be free of these classname substrings (D-J8: no gold on an ask). */
function expectNoGoldInk(html: string) {
  expect(html).not.toContain('gold');
  expect(html).not.toContain('foil');
  expect(html).not.toContain('text-win');
  expect(html).not.toContain('bg-win');
  expect(html).not.toContain('text-loss');
}

describe('SaveAskCard (the shared neutral ask, D-J8)', () => {
  const html = renderToStaticMarkup(
    <SaveAskCard
      testId="ask-under-test"
      recordSummary="3-day streak · 5 picks on this device"
      fact={CLAIM_NUDGE_COPY.streak}
      actions={<span>Save</span>}
    />,
  );

  it('renders the record summary line and the WS21-T1 fact copy on a paper ticket', () => {
    expect(html).toContain('data-testid="ask-under-test"');
    expect(html).toContain('3-day streak · 5 picks on this device');
    expect(html).toContain(CLAIM_NUDGE_COPY.streak);
    // Neutral paper stock (TicketFrame paper tone), never a win surface.
    expect(html).toContain('bg-paper');
  });

  it('uses no gold / foil / win ink anywhere (D-J8 — asserted on classnames)', () => {
    expectNoGoldInk(html);
  });
});

describe('SaveChip (value-gated, one word, D-J8)', () => {
  it('renders the one-word Save chip when a ghost has a streak, linking to /claim?next=', () => {
    mockStatus = { claimed: false, streak: 3, gradedPicks: 0 };
    mockPathname = '/rivals';
    const html = renderToStaticMarkup(<SaveChip />);
    expect(html).toContain('data-testid="save-chip"');
    expect(html).toContain('href="/claim?next=%2Frivals"');
    // one word "Save".
    expect(html).toContain(`>${CLAIM_PROMPT_CTA}<`);
    expectNoGoldInk(html);
  });

  it('renders when a ghost has ≥1 pick but no streak', () => {
    mockStatus = { claimed: false, streak: 0, gradedPicks: 1 };
    mockPathname = '/';
    expect(renderToStaticMarkup(<SaveChip />)).toContain('data-testid="save-chip"');
  });

  it('renders nothing when there is no value to lose (fresh ghost, 0 streak / 0 picks)', () => {
    mockStatus = { claimed: false, streak: 0, gradedPicks: 0 };
    mockPathname = '/';
    expect(renderToStaticMarkup(<SaveChip />)).toBe('');
  });

  it('renders nothing for a claimed viewer, even with a streak', () => {
    mockStatus = { claimed: true, streak: 9, gradedPicks: 9 };
    mockPathname = '/';
    expect(renderToStaticMarkup(<SaveChip />)).toBe('');
  });

  it('renders nothing for an anonymous visitor (no /me status)', () => {
    mockStatus = null;
    mockPathname = '/';
    expect(renderToStaticMarkup(<SaveChip />)).toBe('');
  });

  it('never shows itself on the Save screen', () => {
    mockStatus = { claimed: false, streak: 3, gradedPicks: 5 };
    mockPathname = '/claim';
    expect(renderToStaticMarkup(<SaveChip />)).toBe('');
  });
});

describe('SaveRow (/you ghost save row, D-J8)', () => {
  it('renders the neutral ask for a ghost, linking Save back to /you, with no gold', () => {
    mockStatus = { claimed: false, streak: 2, gradedPicks: 4 };
    const html = renderToStaticMarkup(<SaveRow next="/you" />);
    expect(html).toContain('data-testid="you-save-row"');
    expect(html).toContain('data-testid="you-save-row-cta"');
    expect(html).toContain('href="/claim?next=%2Fyou"');
    // A streak present → the streak fact; otherwise the fingerprint fact (both WS21-T1 copy).
    expect(html).toContain(CLAIM_NUDGE_COPY.streak);
    expectNoGoldInk(html);
  });

  it('uses the fingerprint fact when there is no streak', () => {
    mockStatus = { claimed: false, streak: 0, gradedPicks: 4 };
    const html = renderToStaticMarkup(<SaveRow next="/you" />);
    expect(html).toContain(CLAIM_NUDGE_COPY.fingerprint);
  });

  it('renders nothing once the viewer is claimed (nothing left to save)', () => {
    mockStatus = { claimed: true, streak: 5, gradedPicks: 5 };
    expect(renderToStaticMarkup(<SaveRow next="/you" />)).toBe('');
  });

  it('renders nothing for an anonymous visitor (no record on this device yet)', () => {
    mockStatus = null;
    expect(renderToStaticMarkup(<SaveRow next="/you" />)).toBe('');
  });
});
