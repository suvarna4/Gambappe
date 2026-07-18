'use client';

import { useState } from 'react';
import type { MarketSide } from '@receipts/ui';
import { copy } from '@/lib/copy';

export interface PickButtonsProps {
  yesLabel: string;
  noLabel: string;
  /** DD-11/INV-9: the profile hasn't attested 18+ yet — the tap becomes a two-part flow
   * (side tap, then an explicit confirm) rather than submitting immediately. */
  ageGateRequired: boolean;
  disabled?: boolean;
  /** Only called once any required age-gate confirm has happened; `ageAttested` tells the
   * caller whether this call includes a fresh attestation to send as `age_attested: true`. */
  onPick: (side: MarketSide, ageAttested: boolean) => void;
}

/** One-tap (or, pre-attestation, two-tap) pick buttons (§10.3 `open` state, §6.2 step 0). */
export function PickButtons({
  yesLabel,
  noLabel,
  ageGateRequired,
  disabled,
  onPick,
}: PickButtonsProps) {
  const [pendingSide, setPendingSide] = useState<MarketSide | null>(null);

  function tap(side: MarketSide) {
    if (disabled) return;
    if (ageGateRequired) {
      setPendingSide(side);
      return;
    }
    onPick(side, false);
  }

  function confirmAgeGate() {
    if (!pendingSide) return;
    onPick(pendingSide, true);
    setPendingSide(null);
  }

  if (pendingSide) {
    return (
      <div className="space-y-2" data-testid="age-gate">
        <p className="text-muted text-sm">{copy.question.ageGatePrompt}</p>
        <div className="flex gap-3">
          <button
            type="button"
            data-testid="age-gate-confirm"
            onClick={confirmAgeGate}
            className="bg-win text-ink min-h-11 rounded px-4 py-2 text-sm font-semibold"
          >
            {copy.question.ageGateConfirm}
          </button>
          <button
            type="button"
            data-testid="age-gate-cancel"
            onClick={() => setPendingSide(null)}
            className="text-muted min-h-11 rounded border px-4 py-2 text-sm"
          >
            {copy.question.ageGateCancel}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-muted text-xs font-semibold uppercase">{copy.question.pickPrompt}</p>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          data-testid="pick-yes"
          disabled={disabled}
          onClick={() => tap('yes')}
          className="border-side-a text-side-a min-h-11 min-w-[44px] rounded border-2 px-4 py-2 text-sm font-semibold disabled:opacity-50"
        >
          {yesLabel}
        </button>
        <button
          type="button"
          data-testid="pick-no"
          disabled={disabled}
          onClick={() => tap('no')}
          className="border-side-b text-side-b min-h-11 min-w-[44px] rounded border-2 px-4 py-2 text-sm font-semibold disabled:opacity-50"
        >
          {noLabel}
        </button>
      </div>
    </div>
  );
}
