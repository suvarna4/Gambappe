'use client';

import { useEffect, useState } from 'react';
import { PRINT_EASE, PRINT_MS } from '@receipts/ui';
import { ballotCopy, copy } from '@/lib/copy';

export interface ReceiptSlipProps {
  /** Venue side word of the pick (e.g. "CUTS"). */
  sideLabel: string;
  /** Chosen side's stamped entry price in cents (from `yes_price_at_entry`, §2.4). */
  entryCents: number;
  /** Ghost/claimed handle for the header; falls back to a generic label when unknown. */
  handle?: string;
  /** Pre-formatted stamp time, e.g. "09:42:07 ET". */
  pickedAtLabel: string;
  /** Footer-right serial, e.g. "№ 2026-07-19". */
  serial: string;
  /** Footer-left sealed-crowd note, e.g. "CROWD HIDDEN UNTIL LOCK · 12:00 ET". */
  sealedNote: string;
  /** Undo seconds remaining; `null`/≤0 → the window has closed (prints a static "locked ✓"). */
  secondsLeft: number | null;
  onUndo: () => void;
  /** Busy: the undo control disables (a request is already in flight). */
  disabled?: boolean;
  /** Skip the print slide (honored by the caller's reduced-motion state). */
  reducedMotion?: boolean;
}

/**
 * SW1-T3 · The printed receipt (swipe-ux-plan §2.4). A paper slip that prints upward from the
 * stage's bottom edge on commit: perforation, mono numerals, the stamped side + entry price, the
 * timestamp, and the 60s undo as a printed link (§10.3). Entry price + timestamp come from the
 * POST response the caller threads in — never a client clock or the drifting live price. Undo
 * retracts the slip and returns the card (the caller clears the pick). `aria-live` announces the
 * print for screen-reader users.
 */
export function ReceiptSlip({
  sideLabel,
  entryCents,
  handle,
  pickedAtLabel,
  serial,
  sealedNote,
  secondsLeft,
  onUndo,
  disabled = false,
  reducedMotion = false,
}: ReceiptSlipProps) {
  // Print-on-mount: start off-screen, then slide in on the first client frame. Under reduced
  // motion (or SSR) it's printed immediately, so the static markup is the resting state.
  const [printed, setPrinted] = useState(reducedMotion);
  useEffect(() => {
    if (reducedMotion) return;
    const id = requestAnimationFrame(() => setPrinted(true));
    return () => cancelAnimationFrame(id);
  }, [reducedMotion]);

  const undoOpen = secondsLeft !== null && secondsLeft > 0;

  return (
    <div
      data-testid="receipt-slip"
      aria-live="polite"
      className="bg-paper text-ink relative overflow-hidden rounded-md px-4 pt-3 pb-3 shadow-[0_-10px_30px_rgba(0,0,0,0.5)]"
      style={{
        transform: printed ? 'translateY(0)' : 'translateY(112%)',
        transition: reducedMotion ? undefined : `transform ${PRINT_MS}ms ${PRINT_EASE}`,
      }}
    >
      <div className="text-muted flex items-center justify-between font-mono text-[10px] tracking-wide uppercase">
        <span>{handle ? `Receipt — ${handle}` : copy.question.yourPickLabel}</span>
        <span>{pickedAtLabel}</span>
      </div>

      <div className="mt-1.5 flex items-center justify-between">
        <span
          className="border-ink text-ink inline-block -rotate-6 rounded border-2 px-2.5 py-0.5 font-display text-base font-bold uppercase"
          aria-label={ballotCopy.receiptPrinted(sideLabel, entryCents)}
        >
          {sideLabel} @ {entryCents}¢
        </span>
        {undoOpen ? (
          <button
            type="button"
            data-testid="undo-pick"
            onClick={onUndo}
            disabled={disabled}
            className="text-muted min-h-11 font-mono text-[11px] underline disabled:opacity-50"
          >
            {copy.question.undoButton} · {secondsLeft}s
          </button>
        ) : (
          <span data-testid="undo-locked" className="text-muted font-mono text-[11px]">
            {ballotCopy.undoLocked}
          </span>
        )}
      </div>

      <div
        aria-hidden="true"
        className="mt-2.5 -mx-4 h-1.5"
        style={{
          backgroundImage: 'radial-gradient(circle at center, #0B0B0D 40%, transparent 42%)',
          backgroundSize: '10px 10px',
          backgroundPosition: 'center',
        }}
      />

      <div className="text-muted mt-2 flex items-center justify-between font-mono text-[9px] tracking-wide uppercase">
        <span>{sealedNote}</span>
        <span>{serial}</span>
      </div>
    </div>
  );
}
