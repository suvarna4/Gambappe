'use client';

import { useState } from 'react';
import { SIDE_ORDER, sideAxisPair, type MarketSide } from '@receipts/ui';
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
  /** Uncontrolled initial value for the age-gate's pending side. Exists so the D-SW9
   * axis-order unit test (`test/side-axis-order.test.tsx`) can render the age-gate state
   * without a DOM driver (this repo has no jsdom/@testing-library) — product callers omit it. */
  defaultPendingSide?: MarketSide | null;
}

const PICK_BUTTON_CLASS: Record<MarketSide, string> = {
  yes: 'border-side-a text-side-a',
  no: 'border-side-b text-side-b',
};

/**
 * One-tap (or, pre-attestation, two-tap) pick buttons (§10.3 `open` state, §6.2 step 0).
 *
 * Axis order (D-SW9, swipe plan §2.2): NO/against is visually LEFT, YES/for visually RIGHT —
 * so button position agrees with swipe-left = against. Pair containers set `dir="ltr"`
 * because left/right here are gesture space, not logical order — RTL locales must not mirror
 * them. Same rule orders the age-gate pair: cancel (negative) left, confirm (affirmative) right.
 */
export function PickButtons({
  yesLabel,
  noLabel,
  ageGateRequired,
  disabled,
  onPick,
  defaultPendingSide = null,
}: PickButtonsProps) {
  const [pendingSide, setPendingSide] = useState<MarketSide | null>(defaultPendingSide);
  const labels: Record<MarketSide, string> = { yes: yesLabel, no: noLabel };

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
        <div dir="ltr" className="flex gap-3">
          {sideAxisPair(
            <button
              key="no"
              type="button"
              data-testid="age-gate-cancel"
              data-side="no"
              onClick={() => setPendingSide(null)}
              className="text-muted min-h-11 rounded border px-4 py-2 text-sm"
            >
              {copy.question.ageGateCancel}
            </button>,
            <button
              key="yes"
              type="button"
              data-testid="age-gate-confirm"
              data-side="yes"
              onClick={confirmAgeGate}
              className="bg-win text-ink min-h-11 rounded px-4 py-2 text-sm font-semibold"
            >
              {copy.question.ageGateConfirm}
            </button>,
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-muted text-xs font-semibold uppercase">{copy.question.pickPrompt}</p>
      <div dir="ltr" className="flex flex-wrap gap-3">
        {SIDE_ORDER.map((side) => (
          <button
            key={side}
            type="button"
            data-testid={`pick-${side}`}
            data-side={side}
            disabled={disabled}
            onClick={() => tap(side)}
            className={`${PICK_BUTTON_CLASS[side]} min-h-11 min-w-[44px] rounded border-2 px-4 py-2 text-sm font-semibold disabled:opacity-50`}
          >
            {labels[side]}
          </button>
        ))}
      </div>
    </div>
  );
}
