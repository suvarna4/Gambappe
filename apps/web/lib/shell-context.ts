'use client';

import {
  createContext,
  createElement,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/**
 * WS17-T1 · The deck-on-stage boolean context (D-J6). The app shell mounts one
 * `DeckStageProvider` at the root (`AppShell`); the bottom tab bar reads `useDeckOnStage()` and
 * translates itself below the viewport while it's `true`. The full-screen open-question deck on
 * `/` (D-SW4 ritual) flips it via `useSetDeckOnStage(true)` so the bar sinks away, then back to
 * `false` when it leaves the stage.
 *
 * `null` default (no provider) reads as `false` — a bare `useDeckOnStage()` outside the shell is
 * safe and simply never hides anything, so components can consume it without asserting a mount.
 * This file stays `.ts` (per the seam-1 spec) by building the provider element with
 * `createElement` instead of JSX.
 */
interface DeckStageValue {
  onStage: boolean;
  setOnStage: (onStage: boolean) => void;
}

const DeckStageContext = createContext<DeckStageValue | null>(null);

export function DeckStageProvider({ children }: { children: ReactNode }) {
  const [onStage, setOnStage] = useState(false);
  const value = useMemo<DeckStageValue>(() => ({ onStage, setOnStage }), [onStage]);
  return createElement(DeckStageContext.Provider, { value }, children);
}

/** `true` while an open question's deck is full-screen on `/` — the tab bar hides on `true`. */
export function useDeckOnStage(): boolean {
  return useContext(DeckStageContext)?.onStage ?? false;
}

/**
 * The setter the deck uses to raise/lower itself onto the stage. Outside a provider it's a no-op,
 * so a deck rendered in isolation (tests, storybook) doesn't throw.
 */
export function useSetDeckOnStage(): (onStage: boolean) => void {
  return useContext(DeckStageContext)?.setOnStage ?? (() => {});
}
