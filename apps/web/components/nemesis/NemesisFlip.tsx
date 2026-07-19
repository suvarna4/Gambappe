import type { MarketSide } from '@receipts/core';
import { nemesisCopy } from '@/lib/copy';

export interface NemesisFlipProps {
  opponentHandle: string;
  /** The opponent's sealed pick, revealed only once the viewer has locked (the caller must not
   * fetch or pass this before the viewer's own pick exists — §2.9 no-anchoring rule). */
  opponentSide: MarketSide;
  opponentSideLabel: string;
  opponentEntryCents: number;
  /** One engine-narrated line from the narration system (§13.3), rendered by the caller. */
  narration: string;
  /** Head-to-head wins this week, viewer-relative. */
  youWins: number;
  opponentWins: number;
  /** e.g. "Week 30 · Day 2". */
  weekLabel: string;
  className?: string;
}

/**
 * SW5-T1 · The nemesis daily "flip" (swipe-ux-plan §2.9): the second section that prints onto the
 * receipt once you've locked during an active nemesis week — the opponent's now-unsealed stamp,
 * one data-narrated line, and the week tally. "Same throw, now it's personal." Purely
 * presentational; `ViewerStrip` mounts it beneath the `ReceiptSlip` only after the viewer's pick
 * exists (so the opponent's side is never fetched early), gated on the `nemesis` flag.
 */
export function NemesisFlip({
  opponentHandle,
  opponentSide,
  opponentSideLabel,
  opponentEntryCents,
  narration,
  youWins,
  opponentWins,
  weekLabel,
  className = '',
}: NemesisFlipProps) {
  // Bright side hues fail AA as text on paper (caught by SW8-T1 axe) — keep the bright border but
  // print the label in a darkened on-paper side ink (#1d4fa8 / #b34d0a, ~6:1 on cream).
  const stampColor =
    opponentSide === 'yes' ? 'border-side-a text-[#1d4fa8]' : 'border-side-b text-[#b34d0a]';
  return (
    <div
      data-testid="nemesis-flip"
      className={`bg-paper text-ink rounded-md border-t border-dashed border-ink/30 px-4 py-3 ${className}`}
    >
      <p className="text-ink/70 font-mono text-[9px] font-semibold tracking-widest uppercase">
        {nemesisCopy.flipSealedNote(opponentHandle)}
      </p>
      <div className="mt-1.5">
        <span
          className={`${stampColor} inline-block -rotate-6 rounded border-2 px-2.5 py-0.5 font-display text-base font-bold uppercase`}
          aria-label={`${opponentHandle}: ${opponentSideLabel} at ${opponentEntryCents}% implied`}
        >
          {opponentSideLabel} @ {opponentEntryCents}¢
        </span>
      </div>
      <p className="text-ink/70 mt-2 font-mono text-[11px] leading-relaxed">{narration}</p>
      <div className="text-ink/70 mt-2 flex items-center justify-between font-mono text-[9px] tracking-wide uppercase">
        <span>{weekLabel}</span>
        <span className="text-ink font-semibold">
          {nemesisCopy.flipTally(opponentHandle, youWins, opponentWins)}
        </span>
      </div>
    </div>
  );
}
