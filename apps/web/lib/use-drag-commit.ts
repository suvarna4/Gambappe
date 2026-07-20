'use client';

/**
 * SW10-T2 · The drag → arm-at-threshold → commit state machine, extracted from `SwipeBallot`
 * (SW1-T2, swipe-ux-plan §2.3) so `VerdictCard`'s rematch-by-swipe gesture can reuse the exact
 * same engine instead of forking a second copy of the drag/arm/commit logic. The pure math
 * (`dragProgress`/`isCommit`) already lived in `@receipts/ui`, shared; what wasn't shared was the
 * React state + Pointer Event wiring around it, which is what this hook now owns.
 *
 * Direction is generic (`left`/`right`), not `MarketSide`-typed: `SwipeBallot` maps
 * `right`→`'yes'`/`left`→`'no'` (D-SW9's affirmative-right axis), `VerdictCard`'s
 * `VerdictSwipeCard` wrapper maps `right`→"Run it back"/`left`→"New fate" — same axis rule,
 * different domain, so the direction stays domain-free here.
 */
import { useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { dragProgress, HAPTIC_ARM, isCommit } from '@receipts/ui';

/** Vibrate if the API exists; a no-op everywhere else (never gate behavior on it). Shared by
 * every drag-commit surface (`SwipeBallot`, `VerdictSwipeCard`) so the feedback stays uniform. */
export function haptic(pattern: number | readonly number[]): void {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    navigator.vibrate(pattern as number | number[]);
  }
}

export type DragDirection = 'left' | 'right';

export interface UseDragCommitOptions {
  /** Busy/blocked: pointer-down is ignored entirely (matches `SwipeBallot`'s `disabled` gate). */
  disabled?: boolean;
  /** Fires on release past the commit threshold with the side that committed (D-SW9: right =
   * for/affirmative, left = against). The hook has already reset its own drag state by the time
   * this fires, so a handler is free to unmount/replace whatever it's wrapping. */
  onCommit: (direction: DragDirection) => void;
}

export interface DragCommitEngine {
  /** Attach to the draggable surface — its `offsetWidth` at drag time sizes the commit
   * threshold, exactly like `SwipeBallot`'s `cardRef`. */
  cardRef: React.RefObject<HTMLDivElement | null>;
  dx: number;
  dragging: boolean;
  armed: boolean;
  progress: number;
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
}

export function useDragCommit({ disabled = false, onCommit }: UseDragCommitOptions): DragCommitEngine {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [armed, setArmed] = useState(false);

  const cardRef = useRef<HTMLDivElement>(null);
  const startX = useRef(0);
  const armedRef = useRef(false);

  const width = () => cardRef.current?.offsetWidth ?? 0;
  const progress = dragProgress(dx, width());

  function reset() {
    setDx(0);
    setArmed(false);
    armedRef.current = false;
  }

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (disabled) return;
    setDragging(true);
    startX.current = e.clientX;
    setDx(0);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!dragging) return;
    const nextDx = e.clientX - startX.current;
    setDx(nextDx);
    const p = dragProgress(nextDx, width());
    if (isCommit(p) && !armedRef.current) {
      armedRef.current = true;
      setArmed(true);
      haptic(HAPTIC_ARM);
    } else if (!isCommit(p) && armedRef.current) {
      armedRef.current = false;
      setArmed(false);
    }
  }

  function endDrag() {
    if (!dragging) return;
    setDragging(false);
    if (isCommit(dragProgress(dx, width()))) {
      const direction: DragDirection = dx > 0 ? 'right' : 'left';
      reset();
      onCommit(direction);
    } else {
      reset();
    }
  }

  return {
    cardRef,
    dx,
    dragging,
    armed,
    progress,
    onPointerDown,
    onPointerMove,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
  };
}
