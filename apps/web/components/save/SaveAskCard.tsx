import type { ReactNode } from 'react';
import { TicketFrame } from '@receipts/ui';
import { saveAskCopy } from '@/lib/copy';

export interface SaveAskCardProps {
  /** ch. 08-B record-summary line (mono eyebrow) — what's forming on this device. */
  recordSummary: string;
  /** The fact line — a WS21-T1 pinned nudge string (`CLAIM_NUDGE_COPY[trigger]`). */
  fact: string;
  /**
   * The action row: Save (primary) + optional "Not now". The caller owns the buttons so the SAME
   * neutral card backs both the dismissible trigger nudge (opens the claim sheet) and the `/you`
   * save row (a link to `/claim`). Every action must stay neutral — no gold / win / foil ink.
   */
  actions: ReactNode;
  /** Test hook on the card body (the no-gold unit test targets this). */
  testId?: string;
}

/**
 * WS21-T2 (journeys plan §5, D-J8, v3 artifact ch. 08-B) · The neutral Save ask card. ONE paper
 * `TicketFrame` — record summary line → fact → actions — backing every Save ask surface (the value-
 * triggered nudge and the `/you` save row). Neutral BY CONSTRUCTION: paper stock + `text-ink` only,
 * with NO gold / foil / win ink anywhere (gold is for wins — D-J8). The record chrome reuses WS21-
 * T1's `SAVE YOUR RECORD` admit bar. The no-gold unit test renders this and asserts the classnames.
 */
export function SaveAskCard({ recordSummary, fact, actions, testId }: SaveAskCardProps) {
  return (
    <TicketFrame
      header={{ left: saveAskCopy.admitLeft, right: saveAskCopy.admitRight }}
      notches
      className="w-full shadow-lg"
    >
      <div className="space-y-2" data-testid={testId}>
        <p className="text-ink/70 font-mono text-[10px] font-semibold tracking-[0.18em] uppercase">
          {recordSummary}
        </p>
        <p className="text-ink text-sm font-medium">{fact}</p>
        <div className="flex flex-wrap items-center gap-3 pt-1">{actions}</div>
      </div>
    </TicketFrame>
  );
}
