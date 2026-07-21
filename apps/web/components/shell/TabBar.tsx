'use client';

import Link from 'next/link';

/**
 * WS17-T1 · SHELL_ROUTES (seam 5). The five rooms have their canonical paths (`/`, `/sweat`,
 * `/rivals`, `/crowd`, `/you`), but until WS19/WS22 build those routes the tabs point at the
 * routes that exist today. Each value is a single string so the follow-up tasks flip exactly ONE
 * line here and nothing else:
 *   - WS19-T2  → `'/sweat'`   (open-positions room)
 *   - WS17-T2  → `'/rivals'`  (the Rivals hub)
 *   - WS22-T2  → `'/crowd'`   (leaderboards room)
 *   - WS22-T1  → `'/you'`     (record page)
 * Keyed by the canonical path (never mutated); the value is the live destination.
 */
export const SHELL_ROUTES = {
  '/': '/',
  '/sweat': '/q', // WS19-T2 flips → '/sweat'
  '/rivals': '/nemesis', // WS17-T2 flips → '/rivals'
  '/crowd': '/q', // WS22-T2 flips → '/crowd'
  '/you': '/settings', // WS22-T1 flips → '/you'
} as const;

export type ShellRoute = keyof typeof SHELL_ROUTES;

interface TabDef {
  key: string;
  label: string;
  /** Canonical route + `SHELL_ROUTES` key; the rendered `href` is `SHELL_ROUTES[route]`. */
  route: ShellRoute;
  /** Decorative glyph (aria-hidden — the visible label supplies the accessible name). */
  icon: string;
}

const TABS: readonly TabDef[] = [
  { key: 'stack', label: 'Stack', route: '/', icon: '◎' },
  { key: 'sweat', label: 'Sweat', route: '/sweat', icon: '⏳' },
  { key: 'rivals', label: 'Rivals', route: '/rivals', icon: '⚔' },
  { key: 'crowd', label: 'Crowd', route: '/crowd', icon: '◴' },
  { key: 'you', label: 'You', route: '/you', icon: '◐' },
];

/**
 * Which room the current pathname belongs to (prefix match), or `null` for routes outside the
 * five rooms. The alias rules (journeys-plan §5 WS17-T1) map today's real routes onto their
 * eventual room so the right tab lights up before WS19/WS22 rename anything:
 *   - `/nemesis*`, `/duo*`, `/ladder`, `/vs/*` → Rivals
 *   - `/q*` → Stack (this is where Sweat/Crowd currently land too, hence they read as Stack for now)
 */
export function resolveActiveTab(pathname: string): string | null {
  if (
    pathname.startsWith('/nemesis') ||
    pathname.startsWith('/duo') ||
    pathname.startsWith('/ladder') ||
    pathname.startsWith('/vs') ||
    pathname.startsWith('/rivals')
  ) {
    return 'rivals';
  }
  if (pathname === '/' || pathname.startsWith('/q')) return 'stack';
  if (pathname.startsWith('/sweat')) return 'sweat';
  if (pathname.startsWith('/crowd')) return 'crowd';
  if (pathname.startsWith('/you')) return 'you';
  return null;
}

export interface TabBarProps {
  /** Current route (the shell reads `usePathname()` and passes it so this stays pure/testable). */
  pathname: string;
  /** D-J6: when the open-question deck is on stage, the bar translates below the viewport. */
  hidden?: boolean;
}

/**
 * WS17-T1 · The five-room bottom tab bar (D-J6), mounted once by `AppShell`. `position: fixed`
 * on the bottom edge with safe-area padding and a blurred `bg` wash (the artifact's navbar
 * recipe). Pure/presentational: the shell supplies `pathname` and `hidden`, so this renders the
 * same in a node unit test and in the browser.
 *
 * a11y: labels are the accessible name (icons are `aria-hidden`); inactive tabs use `text-muted`
 * (#8B8B93 → 5.8:1 on `bg`, AA-safe) and the active tab `text-paper` (#F4F1E8 → ~15:1). No gold —
 * gold is reserved for wins (D-J8). While `hidden`, the bar is `aria-hidden` and non-interactive
 * so it's out of the tab order (and its links can't be tabbed to behind the deck).
 */
export function TabBar({ pathname, hidden = false }: TabBarProps) {
  const active = resolveActiveTab(pathname);
  return (
    <nav
      data-testid="tab-bar"
      aria-label="Primary"
      aria-hidden={hidden || undefined}
      className={`border-surface bg-bg/85 fixed inset-x-0 bottom-0 z-50 border-t backdrop-blur-md motion-safe:transition-transform motion-safe:duration-200 ${
        hidden ? 'pointer-events-none translate-y-full' : 'translate-y-0'
      }`}
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="mx-auto flex max-w-xl items-stretch justify-around">
        {TABS.map((tab) => {
          const isActive = tab.key === active;
          return (
            <li key={tab.key} className="flex-1">
              <Link
                href={SHELL_ROUTES[tab.route]}
                data-testid={`tab-${tab.key}`}
                aria-current={isActive ? 'page' : undefined}
                tabIndex={hidden ? -1 : undefined}
                className={`font-display flex flex-col items-center gap-0.5 py-2 text-[10px] font-bold tracking-wide uppercase transition-colors ${
                  isActive ? 'text-paper' : 'text-muted'
                }`}
              >
                <span aria-hidden="true" className="text-lg leading-none">
                  {tab.icon}
                </span>
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
