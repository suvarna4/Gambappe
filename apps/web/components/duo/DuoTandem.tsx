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
 * SW5-T3 · The duo shared-deck tandem line (swipe-ux-plan §2.9): once the viewer locks during a
 * duo series, the receipt gains both partners' stamps and a MATCHED / SPLIT verdict — the split
 * is the micro-drama ("one of you is wrong"). Purely presentational; `ViewerStrip`/the duo
 * surface mounts it after the viewer's pick, gated on the `duo_queue` flag, and never fetches the
 * partner's side before the viewer has one.
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
