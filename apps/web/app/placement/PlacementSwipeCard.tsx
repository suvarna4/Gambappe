'use client';

import { useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { MarketSide } from '@receipts/core';
import {
  dragProgress,
  dragSide,
  isCommit,
  prefersReducedMotion,
  sideAxisPair,
  stampScale,
  tintOpacity,
} from '@receipts/ui';
import { ballotCopy, copy } from '@/lib/copy';

export interface PlacementSwipeCardProps {
  category: string;
  title: string;
  yesLabel: string;
  noLabel: string;
  disabled?: boolean;
  onPick: (side: MarketSide) => void;
}

/**
 * SW6-T1 · Placement as a swipe (swipe-ux-plan §2.10): the same throw as the daily ballot, over a
 * historical item. Reuses the `swipe.ts` gesture primitives (threshold, tilt, tint, axis) and the
 * wells-are-the-a11y-path rule, but is its own light component — placement items have no live
 * price/venue and the flow reveals the outcome in place with no undo/age-gate, so forcing the full
 * `SwipeBallot` contract would be the wrong fit. Commit calls `onPick(side)` immediately (the
 * caller submits + reveals); reduced motion drops transforms.
 */
export function PlacementSwipeCard({
  category,
  title,
  yesLabel,
  noLabel,
  disabled = false,
  onPick,
}: PlacementSwipeCardProps) {
  const [reducedMotion] = useState(() => prefersReducedMotion());
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const startX = useRef(0);

  const width = () => cardRef.current?.offsetWidth ?? 0;
  const progress = dragProgress(dx, width());
  const activeSide = dragging && Math.abs(dx) > 4 ? dragSide(dx) : null;

  function reset() {
    setDx(0);
    setDragging(false);
  }

  function commit(side: MarketSide) {
    if (disabled) return;
    reset();
    onPick(side);
  }

  // Pointer-drag gesture, mirroring the verified `SwipeBallot` engine (SW1-T2): the `dragging`/`dx`
  // state drives both the visual transform and the handler gates (a setDx per move re-renders, so
  // the next handler closure and `endDrag` always read the latest drag). The tap wells below are
  // real buttons — the always-present keyboard/AT path, so a swipe is never the only way to call it.
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    setDragging(true);
    startX.current = e.clientX;
    setDx(0);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setDx(e.clientX - startX.current);
  };
  const endDrag = () => {
    if (!dragging) return;
    if (isCommit(dragProgress(dx, width()))) commit(dragSide(dx));
    else reset();
  };

  const transform =
    dragging && !reducedMotion
      ? `translate(${dx}px, 0) rotate(${Math.max(-12, Math.min(12, dx * 0.09))}deg)`
      : undefined;

  const previewSide = dragSide(dx);
  const previewLabel = previewSide === 'yes' ? yesLabel : noLabel;

  const wells = sideAxisPair(
    <button
      key="no"
      type="button"
      data-testid="placement-pick-no"
      disabled={disabled}
      onClick={() => commit('no')}
      className="border-side-b text-side-b min-h-12 flex-1 rounded-lg border-2 font-display text-sm font-bold tracking-wide uppercase disabled:opacity-50"
    >
      {ballotCopy.wellAgainstGlyph} {noLabel}
    </button>,
    <button
      key="yes"
      type="button"
      data-testid="placement-pick-yes"
      disabled={disabled}
      onClick={() => commit('yes')}
      className="border-side-a text-side-a min-h-12 flex-1 rounded-lg border-2 font-display text-sm font-bold tracking-wide uppercase disabled:opacity-50"
    >
      {yesLabel} {ballotCopy.wellForGlyph}
    </button>,
  );

  return (
    <div className="space-y-3" data-testid="placement-swipe">
      <div className="relative">
        {activeSide ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -inset-6 rounded-3xl"
            style={{
              background:
                activeSide === 'yes'
                  ? 'radial-gradient(120% 90% at 85% 50%, rgba(59,130,246,0.42), transparent 62%)'
                  : 'radial-gradient(120% 90% at 15% 50%, rgba(249,115,22,0.42), transparent 62%)',
              opacity: tintOpacity(progress),
            }}
          />
        ) : null}
        <div
          ref={cardRef}
          role="group"
          aria-label={ballotCopy.cardAriaLabel(title, yesLabel, noLabel)}
          data-testid="placement-card"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className="bg-paper text-ink relative touch-none rounded-lg px-4 pt-3 pb-4 shadow-[0_14px_34px_rgba(0,0,0,0.5)] select-none"
          style={{
            transform,
            transition: dragging ? 'none' : 'transform 400ms cubic-bezier(.28,1.6,.5,1)',
            cursor: dragging ? 'grabbing' : 'grab',
          }}
        >
          <p className="text-ink/70 font-mono text-[9px] font-semibold tracking-widest uppercase">
            {category} · {copy.placement.callIt}
          </p>
          <h2 className="font-display mt-2 text-2xl leading-[1.03] font-bold uppercase">{title}</h2>
          {Math.abs(dx) > 4 ? (
            <span
              aria-hidden="true"
              data-testid="placement-preview"
              className={`pointer-events-none absolute top-[46%] left-1/2 -rotate-6 rounded border-2 px-3 py-1 font-display text-lg font-bold uppercase ${previewSide === 'yes' ? 'border-side-a text-[#1d4fa8]' : 'border-side-b text-[#b34d0a]'}`}
              style={{
                transform: `translate(-50%,-50%) rotate(-6deg) scale(${stampScale(progress)})`,
                opacity: Math.min(1, progress),
              }}
            >
              {previewLabel}
            </span>
          ) : null}
        </div>
      </div>
      <div dir="ltr" className="flex gap-2">
        {wells[0]}
        {wells[1]}
      </div>
    </div>
  );
}
