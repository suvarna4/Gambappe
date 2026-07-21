'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';

import { DeckStageProvider, useDeckOnStage } from '@/lib/shell-context';
import { TabBar } from './TabBar';

/**
 * Reads the routing/stage state and renders the bar. Split out from `AppShell` so it lives INSIDE
 * `DeckStageProvider` (where `useDeckOnStage` is valid) while `AppShell` itself stays the mount
 * point other tasks import.
 */
function ShellChrome() {
  const pathname = usePathname();
  const deckOnStage = useDeckOnStage();
  return <TabBar pathname={pathname ?? '/'} hidden={deckOnStage} />;
}

export interface AppShellProps {
  children: ReactNode;
  /**
   * Ghost top-bar right slot — reserved for the Save chip (WS21-T2). Rendered as an empty,
   * non-interactive slot for now; the prop is wired through so that task fills it without
   * touching the shell's structure (seam 1).
   */
  saveChipSlot?: ReactNode;
}

/**
 * WS17-T1 · The app shell (D-J6), wrapped once around `{children}` in `app/layout.tsx` (seam 1).
 * Provides the deck-on-stage context, reserves the fixed tab bar's height on the content column so
 * there's no layout shift and nothing sits under the bar (INV-9's footer included), and mounts the
 * bar itself. Everything visible today is unchanged — the bar overlays, the padding keeps content
 * clear, and on `/` the open-question deck sinks the bar via the context (D-SW4 preserved).
 */
export function AppShell({ children, saveChipSlot = null }: AppShellProps) {
  return (
    <DeckStageProvider>
      {/* Ghost top-bar: right slot reserved for WS21-T2's Save chip. Empty + non-interactive now. */}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-40 flex justify-end">
        <div data-testid="save-chip-slot" className="pointer-events-auto">
          {saveChipSlot}
        </div>
      </div>

      {/* Content column. `pb-[…]` reserves the bar height (bar height 4rem + the safe-area inset). */}
      <div className="flex min-h-screen flex-1 flex-col pb-[calc(4rem+env(safe-area-inset-bottom))]">
        {children}
      </div>

      <ShellChrome />
    </DeckStageProvider>
  );
}
