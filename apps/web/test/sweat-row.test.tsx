/**
 * WS19-T2 · `SweatRow` render coverage (journeys-plan §5). Static-markup assertions (repo
 * pattern, mirrors `app-shell.test.tsx`); `next/link` is mocked so the row renders hermetically.
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

import { SweatRow } from '@/components/SweatRow';
import type { SweatPosition } from '@/lib/sweat-feed';

const base: SweatPosition = {
  pickId: '018f1e2b-0000-7000-8000-000000000001',
  slug: 'will-the-fed-cut',
  headline: 'Will the Fed cut in September?',
  side: 'yes',
  sideLabel: 'Cuts',
  entryCents: 63,
  drift: { cents: 5, direction: 'up' },
  settleWhen: { kind: 'weekday', text: 'THU' },
  closeIso: '2026-07-23T18:00:00Z',
};

describe('SweatRow', () => {
  it('renders headline (linked), held side + entry, drift and settle label', () => {
    const html = renderToStaticMarkup(<SweatRow position={base} />);
    expect(html).toContain('data-testid="sweat-row"');
    expect(html).toContain('href="/q/will-the-fed-cut"');
    expect(html).toContain('Will the Fed cut in September?');
    expect(html).toContain('Cuts @ 63¢');
    expect(html).toContain('▲ 5¢');
    expect(html).toContain('THU');
  });

  it('colours an up drift with win ink and a down drift with loss ink (never colour alone)', () => {
    const up = renderToStaticMarkup(<SweatRow position={base} />);
    expect(up).toContain('text-win');
    expect(up).toContain('▲'); // glyph pairs with the hue (§10.4)

    const down = renderToStaticMarkup(
      <SweatRow position={{ ...base, drift: { cents: -8, direction: 'down' } }} />,
    );
    expect(down).toContain('text-loss');
    expect(down).toContain('▼ 8¢');
  });

  it('renders a neutral drift and no link when the price is unknown / the question has no slug', () => {
    const html = renderToStaticMarkup(
      <SweatRow
        position={{ ...base, slug: null, drift: { cents: null, direction: 'unknown' } }}
      />,
    );
    expect(html).not.toContain('href=');
    expect(html).toContain('text-muted');
  });
});
