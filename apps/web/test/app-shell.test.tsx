/**
 * WS17-T1 · App shell + bottom tab bar (D-J6). Node env → static-markup assertions (repo pattern,
 * mirrors `topic-follow-chips.test.tsx`); the browser-only behaviors (2-tap reachability, the
 * deck-on-stage sink driven by the real deck) live in `e2e/shell-nav.spec.ts`. `next/link` and
 * `next/navigation` are mocked so the bar renders hermetically without an app-router mount.
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

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));

import { AppShell } from '@/components/shell/AppShell';
import { SHELL_ROUTES, TabBar, resolveActiveTab } from '@/components/shell/TabBar';

const ROOMS = ['stack', 'sweat', 'rivals', 'crowd', 'you'] as const;

describe('SHELL_ROUTES (seam 5)', () => {
  it('points each room at its live destination (WS19-T2 flipped /sweat to its real room)', () => {
    expect(SHELL_ROUTES).toEqual({
      '/': '/',
      // WS19-T2 · Sweat now points at its own route; the other unbuilt rooms still alias today's.
      '/sweat': '/sweat',
      '/rivals': '/nemesis',
      '/crowd': '/q',
      '/you': '/settings',
    });
  });
});

describe('resolveActiveTab (alias table)', () => {
  it.each([
    ['/', 'stack'],
    ['/q', 'stack'],
    ['/q/some-slug', 'stack'],
    ['/nemesis', 'rivals'],
    ['/nemesis/abc', 'rivals'],
    ['/duo', 'rivals'],
    ['/duos', 'rivals'],
    ['/ladder', 'rivals'],
    ['/vs/xyz', 'rivals'],
    ['/rivals', 'rivals'],
    ['/sweat', 'sweat'],
    ['/crowd', 'crowd'],
    ['/you', 'you'],
  ])('%s → %s', (pathname, expected) => {
    expect(resolveActiveTab(pathname)).toBe(expected);
  });

  it('returns null for routes outside the five rooms', () => {
    expect(resolveActiveTab('/settings')).toBeNull();
    expect(resolveActiveTab('/claim')).toBeNull();
  });
});

describe('TabBar', () => {
  it('renders exactly the five rooms, each linking through SHELL_ROUTES', () => {
    const html = renderToStaticMarkup(<TabBar pathname="/" />);
    for (const room of ROOMS) {
      expect(html).toContain(`data-testid="tab-${room}"`);
    }
    // hrefs come from SHELL_ROUTES, not the canonical room paths (anchor carries both attrs).
    expect(html).toMatch(/href="\/nemesis"[^>]*data-testid="tab-rivals"/);
    expect(html).toMatch(/href="\/settings"[^>]*data-testid="tab-you"/);
    expect(html).toMatch(/href="\/sweat"[^>]*data-testid="tab-sweat"/);
    expect(html).toMatch(/href="\/"[^>]*data-testid="tab-stack"/);
    // the five rooms and nothing else (excluding the `tab-bar` nav itself).
    expect((html.match(/data-testid="tab-(?:stack|sweat|rivals|crowd|you)"/g) ?? []).length).toBe(
      ROOMS.length,
    );
  });

  it('marks the active tab from the pathname with aria-current="page"', () => {
    const onStack = renderToStaticMarkup(<TabBar pathname="/" />);
    expect(onStack).toMatch(/data-testid="tab-stack"[^>]*aria-current="page"/);
    expect(onStack).not.toMatch(/data-testid="tab-rivals"[^>]*aria-current/);

    const onNemesis = renderToStaticMarkup(<TabBar pathname="/nemesis/abc" />);
    expect(onNemesis).toMatch(/data-testid="tab-rivals"[^>]*aria-current="page"/);
    expect(onNemesis).not.toMatch(/data-testid="tab-stack"[^>]*aria-current/);
  });

  it('labels the bar and hides the decorative glyphs from a11y', () => {
    const html = renderToStaticMarkup(<TabBar pathname="/" />);
    expect(html).toContain('aria-label="Primary"');
    expect(html).toContain('aria-hidden="true"'); // the icon spans
  });

  it('sinks + disables the bar when the deck is on stage (D-J6)', () => {
    const hidden = renderToStaticMarkup(<TabBar pathname="/" hidden />);
    expect(hidden).toContain('translate-y-full');
    expect(hidden).toContain('pointer-events-none');
    expect(hidden).toContain('aria-hidden="true"');
    expect(hidden).toContain('tabindex="-1"'); // links pulled from the tab order while hidden

    const shown = renderToStaticMarkup(<TabBar pathname="/" />);
    expect(shown).not.toContain('translate-y-full');
  });

  it('uses only AA-safe, non-gold ink for tab labels (D-J8)', () => {
    const html = renderToStaticMarkup(<TabBar pathname="/nemesis" />);
    // active → bright paper ink (~15:1 on bg); inactive → muted (#8B8B93 → 5.8:1 on bg, AA-safe).
    expect(html).toContain('text-paper');
    expect(html).toContain('text-muted');
    // gold is for wins, never an ambient nav control (mirrors topic-follow-chips' no-gold pin).
    expect(html).not.toContain('gold');
    expect(html).not.toContain('text-win');
    expect(html).not.toContain('text-loss');
  });

  it('animates the sink only under motion-safe (respects reduced motion)', () => {
    const html = renderToStaticMarkup(<TabBar pathname="/" hidden />);
    expect(html).toContain('motion-safe:transition-transform');
    expect(html).toContain('motion-safe:duration-200');
  });
});

describe('AppShell', () => {
  it('mounts the tab bar, reserves its height, and renders the saveChipSlot child', () => {
    const html = renderToStaticMarkup(
      <AppShell saveChipSlot={<span data-testid="save-chip">Save</span>}>
        <main data-testid="page-body">hi</main>
      </AppShell>,
    );
    expect(html).toContain('data-testid="tab-bar"');
    expect(html).toContain('data-testid="page-body"');
    // seam: the reserved right slot renders whatever WS21-T2 hands it.
    expect(html).toContain('data-testid="save-chip-slot"');
    expect(html).toContain('data-testid="save-chip"');
    // no layout shift: the content column reserves the fixed bar's height.
    expect(html).toContain('pb-[calc(4rem+env(safe-area-inset-bottom))]');
  });

  it('renders an empty (but present) save-chip slot when none is provided', () => {
    const html = renderToStaticMarkup(
      <AppShell>
        <main>hi</main>
      </AppShell>,
    );
    expect(html).toContain('data-testid="save-chip-slot"');
    expect(html).not.toContain('data-testid="save-chip"');
  });
});
