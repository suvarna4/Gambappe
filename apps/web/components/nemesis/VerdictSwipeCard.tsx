'use client';

/**
 * SW10-T2 · The drag surface wrapping `VerdictCard`'s rematch-by-swipe close (swipe-ux-plan
 * §2.9, this doc's SW5-T2 entry). Reuses `useDragCommit` — the SAME drag/arm/commit engine
 * `SwipeBallot` drives (SW1-T2) — rather than forking a second copy of the gesture math, per
 * `docs/plans/sw-revamp-wiring-gaps.md`'s SW10-T2 deliverable. Right commit = "Run it back"
 * (rematch request, D-SW9 affirmative-right); left commit = "New fate" (pass — no request).
 *
 * The pointer handlers are threaded into `VerdictCard`'s `dragSurface*` props so they land ONLY
 * on the paper/score card, never the button row below it — `VerdictCard`'s own buttons stay
 * mounted, outside the draggable region, as the always-present tap/keyboard fallback (a swipe is
 * never the only path, same posture as `SwipeBallot`'s wells). Wrapping the buttons INSIDE the
 * pointer-handling surface was tried first and breaks their clicks: a real click starts a
 * (zero-distance) drag on the ancestor first, and `setPointerCapture` there intercepts it.
 */
import { useState } from 'react';
import { HAPTIC_COMMIT, prefersReducedMotion, tiltDeg, tintOpacity } from '@receipts/ui';
import { haptic, useDragCommit } from '@/lib/use-drag-commit';
import { VerdictCard, type VerdictCardProps } from './VerdictCard';

export interface VerdictSwipeCardProps extends Omit<VerdictCardProps, 'onRunItBack' | 'onNewFate'> {
  onRunItBack: () => void;
  onNewFate: () => void;
  /** Busy (a request is in flight): the drag surface ignores input, same posture as
   * `SwipeBallot`'s `disabled`. */
  disabled?: boolean;
}

export function VerdictSwipeCard({
  onRunItBack,
  onNewFate,
  disabled = false,
  className = '',
  ...cardProps
}: VerdictSwipeCardProps) {
  const [reducedMotion] = useState(() => prefersReducedMotion());
  const drag = useDragCommit({
    disabled,
    onCommit: (direction) => {
      // `SwipeBallot` fires `HAPTIC_COMMIT` on its own commit path (fable review of PR #84,
      // round 2) — the shared `useDragCommit` engine only fires the arm buzz, so this surface
      // needs its own commit haptic to match, or a verdict swipe would arm-buzz but never
      // commit-buzz while the pick ballot's does both.
      haptic(HAPTIC_COMMIT);
      if (direction === 'right') onRunItBack();
      else onNewFate();
    },
  });

  const dragTransform =
    drag.dragging && !reducedMotion
      ? `translate(${drag.dx}px, ${drag.dx * 0.25 * 0.25}px) rotate(${tiltDeg(drag.dx)}deg)`
      : undefined;

  return (
    <div className={`relative ${className}`}>
      {/* World-tint wash while dragging — gold toward "run it back," neutral toward "new fate,"
          mirroring `SwipeBallot`'s per-side tint (§2.5). Non-interactive (`pointer-events-none`),
          so it's safe to sit above everything without blocking the buttons either. */}
      {drag.dragging ? (
        <div
          aria-hidden="true"
          data-testid="verdict-tint"
          data-direction={drag.dx > 0 ? 'right' : 'left'}
          className="pointer-events-none absolute -inset-4 rounded-3xl"
          style={{
            background:
              drag.dx > 0
                ? 'radial-gradient(120% 90% at 85% 50%, rgba(212,175,55,0.4), transparent 62%)'
                : 'radial-gradient(120% 90% at 15% 50%, rgba(148,148,148,0.35), transparent 62%)',
            opacity: tintOpacity(drag.progress),
            transition: 'none',
          }}
        />
      ) : null}

      <VerdictCard
        {...cardProps}
        onRunItBack={onRunItBack}
        onNewFate={onNewFate}
        dragSurfaceRef={drag.cardRef}
        dragSurfaceArmed={drag.armed}
        dragSurfaceStyle={{
          transform: dragTransform,
          transition: drag.dragging ? 'none' : 'transform 400ms cubic-bezier(.28,1.6,.5,1)',
          cursor: disabled ? undefined : drag.dragging ? 'grabbing' : 'grab',
        }}
        dragSurfaceHandlers={
          disabled
            ? undefined
            : {
                onPointerDown: drag.onPointerDown,
                onPointerMove: drag.onPointerMove,
                onPointerUp: drag.onPointerUp,
                onPointerCancel: drag.onPointerCancel,
              }
        }
      />
    </div>
  );
}
