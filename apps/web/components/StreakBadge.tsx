'use client';

import { useEffect, useState } from 'react';
import { StreakFlame } from '@receipts/ui';
import { fetchMe } from '@/lib/pick-client';

/**
 * Design-diff audit: the mockup's persistent topbar streak flame (`docs/mockups/swipe-ux.html`
 * "01 THE PRIMITIVE" annotation #1 — "chrome, not content... never leaves the top bar"). Its own
 * identity-dependent island, separate from `ViewerStrip`'s `/me` fetch — same posture
 * `RevealSequence` already established for itself ("owns its own identity fetch... skip the
 * unrelated /me round trip", `ViewerStrip.tsx`'s header) rather than threading this through
 * `ViewerStrip`, whose own fetch result is scoped to the card slot `DeckStage` mounts elsewhere
 * in the tree, not the topbar this renders into. Viewer-free until this resolves (renders
 * nothing, not a skeleton — a one-line mono badge has no meaningful reserved-space shape to hold,
 * unlike `ViewerStrip`'s own `min-h-11` loading slot), so `DeckStage`/`DeckStates`'s own INV-10
 * guarantee is untouched — this island, not the SSR shell, is what varies by viewer.
 */
export function StreakBadge() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchMe()
      .then(({ data }) => {
        if (!cancelled) setCount(data.profile.streak.current);
      })
      .catch(() => {
        // Best-effort, same posture as ViewerStrip's own duo/tomorrow-peek fetches — a failed
        // fetch just leaves the topbar without a count rather than surfacing an error for
        // what's decorative chrome, not the actionable pick flow.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (count === null) return null;
  return <StreakFlame count={count} className="text-gold" />;
}
