import type { MarketSide } from '@receipts/core';
import { duoCopy } from '@/lib/copy';

export interface DuoTandemProps {
  viewerSideLabel: string;
  viewerSide: MarketSide;
  partnerHandle: string;
  /** The partner's sealed pick — passed only once the viewer has locked (§2.9 no-anchoring). */
  partnerSideLabel: string;
  partnerSide: MarketSide;
  className?: string;
}

function sideClasses(side: MarketSide): string {
  // Darkened on-paper side ink for the label text (AA on cream); bright border kept for the pop.
  return side === 'yes' ? 'border-side-a text-[#1d4fa8]' : 'border-side-b text-[#b34d0a]';
}

/**
 * SW5-T3 · The duo shared-deck tandem line (swipe-ux-plan §2.9): both partners' stamps and a
 * MATCHED / SPLIT verdict — the split is the micro-drama ("one of you is wrong"). Purely
 * presentational.
 *
 * **Mount point corrected by SW10-T3 (wiring-gaps doc §4 SW10-T3):** the original "mounts after
 * the viewer's pick" trigger here was unimplementable without violating §9.3's no-probe-by-
 * picking rule — see SW10-T1's note (same fix, same reasoning) for the full explanation. The
 * real mount is `RevealSequence.tsx`, AT REVEAL, alongside `NemesisFlip` — `viewer.duo_tandem`
 * (`packages/core/src/schemas/questions.ts`) is structurally unreachable pre-reveal, so this
 * component never fetches (or receives) the partner's side before that.
 */
export function DuoTandem({
  viewerSideLabel,
  viewerSide,
  partnerHandle,
  partnerSideLabel,
  partnerSide,
  className = '',
}: DuoTandemProps) {
  const matched = viewerSide === partnerSide;
  return (
    <div
      data-testid="duo-tandem"
      data-matched={matched ? 'true' : 'false'}
      className={`bg-paper text-ink rounded-md border-t border-dashed border-ink/30 px-4 py-3 ${className}`}
    >
      <p className="text-ink/70 font-mono text-[9px] font-semibold tracking-widest uppercase">
        {duoCopy.tandemReceiptHeading}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span
          className={`${sideClasses(viewerSide)} inline-block -rotate-6 rounded border-2 px-2 py-0.5 font-display text-sm font-bold uppercase`}
        >
          You: {viewerSideLabel}
        </span>
        <span
          className={`${sideClasses(partnerSide)} inline-block -rotate-3 rounded border-2 px-2 py-0.5 font-display text-sm font-bold uppercase`}
        >
          {partnerHandle}: {partnerSideLabel}
        </span>
        <span
          data-testid="tandem-verdict"
          className={`font-mono text-[11px] font-semibold uppercase ${matched ? 'text-[#0b6b4f]' : 'text-[#6b5200]'}`}
        >
          {matched ? duoCopy.tandemMatched : duoCopy.tandemSplit}
        </span>
      </div>
    </div>
  );
}
