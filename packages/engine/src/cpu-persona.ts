/**
 * CPU nemesis persona pick policies (docs/plans/cpu-nemesis-wbs.md, WS26-T2). Pure and
 * deterministic — a function of the inputs below and nothing else, per this package's
 * no-I/O/no-clock rule.
 *
 * INTEGRITY INVARIANT (review correction 2): a persona sees only what a human sees at pick
 * time — the venue-implied price and the clock. Never the raw pre-lock `yes_count`/`no_count`
 * (§9.3 hides those from humans, so reading them would be an informational edge). "The Fade"
 * therefore fades the *market* favorite, not the crowd.
 */
import { LONGSHOT_THRESHOLD } from '@receipts/core';
import type { CpuPersona, MarketCategory, MarketSide } from '@receipts/core';

// The persona VOCABULARY (CPU_PERSONAS/CpuPersona/isCpuPersona/labels) lives in
// @receipts/core (`cpu.ts`) — it's shared storage/UI vocabulary. Only the policies are here.

/**
 * How close to lock "The Clock" waits before picking. A policy default local to this module
 * (not a cross-package contract): the WS26-T5 sweep passes real time-to-lock, and refinement
 * (WS26-T9) may later tune it per persona instance.
 */
export const CPU_CLOCK_PICK_WINDOW_MS = 15 * 60_000;

export interface CpuPickInputs {
  persona: CpuPersona;
  /** Unused by the base policies; reserved for per-category tuning (WS26-T9). */
  category: MarketCategory;
  /** Current venue-implied YES probability, already clamped to [0.01, 0.99] (§7.3). */
  yesPrice: number;
  /** `lock_at - now`; may be ≤ 0 if the sweep races the lock (the DB rejects late picks). */
  timeToLockMs: number;
}

/**
 * `pick` — place this side now. `wait` — not yet, re-evaluate on a later sweep (only "The
 * Clock" waits). `skip` — this question never fits the persona (e.g. a coin-flip has no
 * favorite to take or fade); the sweep may re-ask harmlessly, the answer won't change.
 */
export type CpuPickDecision =
  { action: 'pick'; side: MarketSide } | { action: 'wait' } | { action: 'skip' };

function favorite(yesPrice: number): MarketSide | null {
  if (yesPrice > 0.5) return 'yes';
  if (yesPrice < 0.5) return 'no';
  return null; // dead-even: no favorite exists
}

export function decideCpuPick(inputs: CpuPickInputs): CpuPickDecision {
  const { persona, yesPrice, timeToLockMs } = inputs;
  switch (persona) {
    case 'chalk': {
      const side = favorite(yesPrice);
      return side ? { action: 'pick', side } : { action: 'skip' };
    }
    case 'fade': {
      const side = favorite(yesPrice);
      if (!side) return { action: 'skip' };
      return { action: 'pick', side: side === 'yes' ? 'no' : 'yes' };
    }
    case 'longshot': {
      // Buy the cheap side when one is at/below the same threshold the narration layer
      // calls a longshot; otherwise this question holds nothing for the persona.
      if (yesPrice <= LONGSHOT_THRESHOLD) return { action: 'pick', side: 'yes' };
      if (1 - yesPrice <= LONGSHOT_THRESHOLD) return { action: 'pick', side: 'no' };
      return { action: 'skip' };
    }
    case 'clock': {
      if (timeToLockMs > CPU_CLOCK_PICK_WINDOW_MS) return { action: 'wait' };
      // Inside the window the side policy is chalk's: timing is the persona's identity,
      // not contrarianism. Dead-even still skips rather than flipping a coin (determinism).
      const side = favorite(yesPrice);
      return side ? { action: 'pick', side } : { action: 'skip' };
    }
  }
}
