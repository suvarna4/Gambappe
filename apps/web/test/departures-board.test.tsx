/**
 * WS24-T1 · `DeparturesBoard` render coverage (journeys-plan §5, STRETCH). Static-markup
 * assertions (repo pattern, mirrors `sweat-row.test.tsx`); `next/link` is mocked so the board
 * renders hermetically. The page-level flag gate (flag off → this component never renders, paper
 * path byte-identical) is proven by `e2e/departures-board.spec.ts`; this covers the board's own
 * layout: `TicketFrame tone="board"`, the STATUS/DESTINATION/DRIFT columns, the FlapText status
 * cell, and the drift's glyph-plus-hue contract carried over from SweatRow.
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

import { DeparturesBoard } from '@/components/DeparturesBoard';
import type { SweatPosition } from '@/lib/sweat-feed';

const positions: SweatPosition[] = [
  {
    pickId: 'p1',
    slug: 'fed-cuts',
    headline: 'Fed cuts rates in September',
    side: 'yes',
    sideLabel: 'Cuts',
    entryCents: 71,
    drift: { cents: 6, direction: 'up' },
    settleWhen: { kind: 'live', text: 'LIVE' },
    closeIso: '2026-07-21T13:00:00Z',
  },
  {
    pickId: 'p2',
    slug: null,
    headline: 'France win the final',
    side: 'no',
    sideLabel: 'No',
    entryCents: 44,
    drift: { cents: -9, direction: 'down' },
    settleWhen: { kind: 'month', text: '~NOV 2026' },
    closeIso: '2026-11-03T23:00:00Z',
  },
];

describe('DeparturesBoard', () => {
  it('renders the dark board frame with the DEPARTURES header and column heads', () => {
    const html = renderToStaticMarkup(<DeparturesBoard positions={positions} />);
    expect(html).toContain('data-testid="departures-board"');
    expect(html).toContain('data-tone="board"'); // TicketFrame tone="board"
    expect(html).toContain('DEPARTURES');
    expect(html).toContain('STATUS');
    expect(html).toContain('DESTINATION');
    expect(html).toContain('DRIFT');
  });

  it('renders one row per position with its FlapText status and deep link when slugged', () => {
    const html = renderToStaticMarkup(<DeparturesBoard positions={positions} />);
    expect((html.match(/data-testid="departures-row"/g) ?? [])).toHaveLength(2);
    // The settle status flows through FlapText (sr-only reading present).
    expect(html).toContain('LIVE');
    expect(html).toContain('~NOV 2026');
    // Held side + entry price reused from sweatCopy.
    expect(html).toContain('Cuts @ 71¢');
    // Slugged question deep-links; the slug-less one does not.
    expect(html).toContain('href="/q/fed-cuts"');
    expect(html).toContain('data-testid="departures-row-link"');
  });

  it('keeps the drift glyph+hue contract (win up, loss down — colour never alone)', () => {
    const html = renderToStaticMarkup(<DeparturesBoard positions={positions} />);
    expect(html).toContain('text-win');
    expect(html).toContain('▲ 6¢');
    expect(html).toContain('text-loss');
    expect(html).toContain('▼ 9¢');
  });

  it('never emits the win-reserved gold token', () => {
    const html = renderToStaticMarkup(<DeparturesBoard positions={positions} animate />);
    expect(html).not.toContain('gold');
  });
});
