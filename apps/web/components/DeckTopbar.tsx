import type { ReactNode } from 'react';

export interface DeckTopbarProps {
  /** Reserved slot for `StreakBadge` (§10.1 "no layout shift on hydration" — the client island
   * mounts here once `/me` resolves; empty until then). */
  streakSlot?: ReactNode;
}

/**
 * Design-diff audit: the mockup's persistent status row (`docs/mockups/swipe-ux.html`'s
 * `.topbar` — "01 THE PRIMITIVE" annotation #1: the streak flame is "chrome, not content... it
 * never leaves the top bar"). Shared by `DeckStage` (open) and `DeckStates` (every other status)
 * so the deck's own chrome doesn't flicker in and out as a question moves between states in the
 * same session. Viewer-free (INV-10) — the brand label is static; only `streakSlot` (a separate
 * client island, `StreakBadge`) varies by viewer, and it's empty in the server-rendered shell.
 *
 * Measurements are the mockup's own `.topbar{padding:8px 14px 4px}` / `font-size:9.5px` values
 * scaled ×1.4, the same real-viewport-vs-250px-demo-frame factor the nemesis screens' own
 * design-diff passes established (`NemesisAssignmentCard.tsx`'s header has the full rationale).
 */
export function DeckTopbar({ streakSlot }: DeckTopbarProps) {
  return (
    <div className="text-muted flex items-center justify-between px-5 pt-[11px] pb-[6px] font-mono text-[13px] uppercase">
      <span className="text-paper font-semibold tracking-[0.16em]">Today</span>
      {streakSlot}
    </div>
  );
}
