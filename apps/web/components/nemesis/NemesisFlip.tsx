import type { MarketSide } from '@receipts/core';
import { nemesisCopy } from '@/lib/copy';

export interface NemesisFlipProps {
  opponentHandle: string;
  /** The opponent's pick — only ever reachable once the question has actually REVEALED (SW10-T1:
   * the block this powers is structurally unreachable pre-reveal, not merely gated by a
   * same-request ordering check — see the component doc comment below). */
  opponentSide: MarketSide;
  opponentSideLabel: string;
  opponentEntryCents: number;
  /** One engine-narrated line from the narration system (§13.3), rendered by the caller. Optional
   * — SW10-T1's degrade rule: when no beat's trigger condition is met (or a required slot is
   * unresolvable), the caller omits this prop entirely and the line is skipped (SW4-T1
   * degrade-by-omission precedent). */
  narration?: string | null;
  /** Head-to-head wins this week, viewer-relative. */
  youWins: number;
  opponentWins: number;
  /** e.g. "Week of Jul 06 · Day 2". */
  weekLabel: string;
  className?: string;
}

/**
 * SW5-T1/SW10-T1 · The nemesis daily "flip" (swipe-ux-plan §2.9): a second section on the
 * receipt during an active nemesis week — the opponent's stamp, one data-narrated line, and the
 * week tally. "Same throw, now it's personal." Purely presentational.
 *
 * Trigger timing (SW10-T1, wiring-gaps doc §3/§4/§9): fires AT REVEAL, not at pick time. The
 * original "unseal once the viewer locks" design was found unimplementable without violating
 * §9.3's no-probe-by-picking rule (it would let a viewer pick, read the opponent's side, undo
 * within the 60s window, and re-pick against it) — the opponent's pick data simply doesn't reach
 * the client until the reveal payload does, well after lock, undo, and grading. `RevealSequence`
 * mounts this once, alongside (never replacing) the existing result stamp/streak/share content,
 * gated on the `nemesis` flag and an active pairing.
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
      {narration != null ? (
        <p className="text-ink/70 mt-2 font-mono text-[11px] leading-relaxed">{narration}</p>
      ) : null}
      <div className="text-ink/70 mt-2 flex items-center justify-between font-mono text-[9px] tracking-wide uppercase">
        <span>{weekLabel}</span>
        <span className="text-ink font-semibold">
          {nemesisCopy.flipTally(opponentHandle, youWins, opponentWins)}
        </span>
      </div>
    </div>
  );
}
