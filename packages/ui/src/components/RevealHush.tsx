'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { HUSH_WINDOW_MS, isHushWindow } from '../format.js';
import { prefersReducedMotion } from '../reduced-motion.js';
import { colors } from '../tokens.js';

export interface RevealHushProps {
  /** ISO `reveal_at` — the hush activates `HUSH_WINDOW_MS` before this and holds until it. */
  targetIso: string;
  serverOffsetMs?: number;
  /** Already-formatted room-count text ("drama, not accounting" — docs/swipe-ux-plan.md §2.6),
   * e.g. `hushCopy.roomCount(n)`. Omit when no cheap source is available; the hush still shows
   * without a count. A pre-formatted string rather than a `(n) => string` formatter: this
   * component is `'use client'` and its caller (`QuestionStateView`) is a Server Component —
   * passing a function as a prop across that boundary throws at runtime ("Functions cannot be
   * passed directly to Client Components"), so the caller must format the string itself. */
  roomCountText?: string;
  /** Caller-owned copy (design doc §10.6: every user-facing string lives in `apps/web/lib/copy.ts`,
   * never baked into a shared component). */
  frozenLabel: string;
  children: ReactNode;
  className?: string;
}

const HUSH_GOLD = colors.gold;

/**
 * §2.6 F1 hush (docs/swipe-ux-plan.md, SW3-T1): starting `HUSH_WINDOW_MS` before reveal, dims the
 * wrapped stage content 8% and shows a FROZEN chip (plus an optional room count). No new
 * endpoints or fields — `roomCountText` is whatever the caller already has on hand.
 *
 * Reduced motion skips the whole effect (§2.13 invariant 4) rather than rendering a static
 * version of it: the hush is atmosphere the product can live without, not information the page
 * depends on, so "no motion" here means "no hush" rather than "hush minus the animation."
 *
 * Fires at most once per mount, mirroring `RevealSequence`'s `play` flag: once the T-10s window
 * is entered the hushed state latches on rather than flapping if a later tick somehow lands back
 * outside `isHushWindow` (e.g. a delayed `serverOffsetMs` correction). One consequence: since this
 * component doesn't itself know when `reveal_at` has actually published (that's a separate 30s
 * poll owned by the caller's data layer), the chip can stay visible for up to that long past the
 * literal reveal moment, until the caller re-renders this component out of the tree entirely.
 */
export function RevealHush({
  targetIso,
  serverOffsetMs = 0,
  roomCountText,
  frozenLabel,
  children,
  className = '',
}: RevealHushProps) {
  const targetMs = new Date(targetIso).getTime();
  const [reducedMotion] = useState(() => prefersReducedMotion());
  const [nowMs, setNowMs] = useState(() => Date.now() + serverOffsetMs);
  const [hushed, setHushed] = useState(false);

  useEffect(() => {
    if (reducedMotion) return;
    const tick = () => setNowMs(Date.now() + serverOffsetMs);
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [serverOffsetMs, reducedMotion]);

  const active = !reducedMotion && isHushWindow(targetMs, nowMs, HUSH_WINDOW_MS);

  useEffect(() => {
    if (active) setHushed(true);
  }, [active]);

  if (!hushed) return <>{children}</>;

  return (
    <div className={`relative ${className}`} data-testid="reveal-hush">
      {children}
      <div aria-hidden="true" className="bg-ink/8 pointer-events-none absolute inset-0 rounded-md" />
      {/* Absolutely positioned over the scrim rather than added to flow below `children` — this
          activates mid-countdown, so adding document-flow height here would shift whatever sits
          after the wrapped content (e.g. the viewer strip) right when the user is watching it. */}
      <div className="absolute inset-x-0 bottom-2 flex items-center justify-center gap-2" aria-live="polite">
        <span
          className="font-mono inline-block rounded border-2 bg-ink/40 px-2 py-0.5 text-xs font-bold tracking-widest uppercase"
          style={{ borderColor: HUSH_GOLD, color: HUSH_GOLD }}
          data-testid="reveal-hush-chip"
        >
          {frozenLabel}
        </span>
        {roomCountText !== undefined ? (
          <span className="text-muted font-mono text-xs" data-testid="reveal-hush-room-count">
            {roomCountText}
          </span>
        ) : null}
      </div>
    </div>
  );
}
