'use client';

import { useEffect } from 'react';

import { useSetDeckOnStage } from '@/lib/shell-context';

/**
 * WS17-T1 · The one wire from the open-question deck to the shell (D-J6). Renders no DOM — it only
 * flips `deckOnStage` while mounted, so the bottom tab bar sinks below the viewport while today's
 * open question is on stage on `/` (D-SW4), then restores it on unmount. Mounted server-side from
 * `app/page.tsx` under the same `swipe_ballot` flag + `open` status the `DeckStage` render is gated
 * on; `active` is derived from that (never viewer data), so `/`'s HTML stays viewer-free (INV-10).
 */
export function DeckStageBridge({ active }: { active: boolean }) {
  const setDeckOnStage = useSetDeckOnStage();
  useEffect(() => {
    if (!active) return;
    setDeckOnStage(true);
    return () => setDeckOnStage(false);
  }, [active, setDeckOnStage]);
  return null;
}
