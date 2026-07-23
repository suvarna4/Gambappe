/**
 * WS26-T2 ACs (docs/plans/cpu-nemesis-wbs.md): pure persona policies over price + time only,
 * deterministic, DB-free. The input type itself is the integrity guardrail — there is no
 * crowd field to leak (review correction 2).
 */
import { describe, expect, it } from 'vitest';
import { CPU_PERSONAS, LONGSHOT_THRESHOLD, isCpuPersona } from '@receipts/core';
import { CPU_CLOCK_PICK_WINDOW_MS, decideCpuPick, type CpuPickInputs } from '../src/cpu-persona.js';

function inputs(overrides: Partial<CpuPickInputs> & Pick<CpuPickInputs, 'persona'>): CpuPickInputs {
  return { category: 'politics', yesPrice: 0.62, timeToLockMs: 6 * 60 * 60_000, ...overrides };
}

describe('decideCpuPick — chalk', () => {
  it('takes the favorite on both sides', () => {
    expect(decideCpuPick(inputs({ persona: 'chalk', yesPrice: 0.62 }))).toEqual({
      action: 'pick',
      side: 'yes',
    });
    expect(decideCpuPick(inputs({ persona: 'chalk', yesPrice: 0.31 }))).toEqual({
      action: 'pick',
      side: 'no',
    });
  });

  it('skips a dead-even market (no favorite exists, and no coin flips — determinism)', () => {
    expect(decideCpuPick(inputs({ persona: 'chalk', yesPrice: 0.5 }))).toEqual({ action: 'skip' });
  });
});

describe('decideCpuPick — fade (market favorite, never the crowd)', () => {
  it('takes the priced underdog on both sides', () => {
    expect(decideCpuPick(inputs({ persona: 'fade', yesPrice: 0.62 }))).toEqual({
      action: 'pick',
      side: 'no',
    });
    expect(decideCpuPick(inputs({ persona: 'fade', yesPrice: 0.31 }))).toEqual({
      action: 'pick',
      side: 'yes',
    });
  });

  it('skips dead-even (nothing to fade)', () => {
    expect(decideCpuPick(inputs({ persona: 'fade', yesPrice: 0.5 }))).toEqual({ action: 'skip' });
  });

  it('the input type carries no crowd data (integrity: §9.3 pre-lock counts are invisible)', () => {
    const shape: CpuPickInputs = inputs({ persona: 'fade' });
    expect(Object.keys(shape).sort()).toEqual(
      ['category', 'persona', 'timeToLockMs', 'yesPrice'].sort(),
    );
  });
});

describe('decideCpuPick — longshot', () => {
  it('buys YES at/below the threshold, NO when the other side is cheap', () => {
    expect(decideCpuPick(inputs({ persona: 'longshot', yesPrice: LONGSHOT_THRESHOLD }))).toEqual({
      action: 'pick',
      side: 'yes',
    });
    expect(
      decideCpuPick(inputs({ persona: 'longshot', yesPrice: 1 - LONGSHOT_THRESHOLD })),
    ).toEqual({ action: 'pick', side: 'no' });
  });

  it('skips when neither side is a longshot (boundary is exclusive above threshold)', () => {
    expect(
      decideCpuPick(inputs({ persona: 'longshot', yesPrice: LONGSHOT_THRESHOLD + 0.01 })),
    ).toEqual({ action: 'skip' });
    expect(decideCpuPick(inputs({ persona: 'longshot', yesPrice: 0.5 }))).toEqual({
      action: 'skip',
    });
  });
});

describe('decideCpuPick — clock', () => {
  it('waits outside the pick window (re-evaluated by a later sweep)', () => {
    expect(
      decideCpuPick(inputs({ persona: 'clock', timeToLockMs: CPU_CLOCK_PICK_WINDOW_MS + 1 })),
    ).toEqual({ action: 'wait' });
  });

  it('picks the favorite inside the window, including exactly at the boundary', () => {
    expect(
      decideCpuPick(
        inputs({ persona: 'clock', yesPrice: 0.62, timeToLockMs: CPU_CLOCK_PICK_WINDOW_MS }),
      ),
    ).toEqual({ action: 'pick', side: 'yes' });
    expect(
      decideCpuPick(inputs({ persona: 'clock', yesPrice: 0.31, timeToLockMs: 60_000 })),
    ).toEqual({ action: 'pick', side: 'no' });
  });

  it('still decides when the sweep races the lock (enforcement is the DB layer, not policy)', () => {
    expect(decideCpuPick(inputs({ persona: 'clock', yesPrice: 0.9, timeToLockMs: -1 }))).toEqual({
      action: 'pick',
      side: 'yes',
    });
  });

  it('skips dead-even even inside the window', () => {
    expect(
      decideCpuPick(inputs({ persona: 'clock', yesPrice: 0.5, timeToLockMs: 60_000 })),
    ).toEqual({ action: 'skip' });
  });
});

describe('roster', () => {
  it('exposes the four personas and a guard', () => {
    expect(CPU_PERSONAS).toEqual(['chalk', 'fade', 'longshot', 'clock']);
    expect(isCpuPersona('fade')).toBe(true);
    expect(isCpuPersona('crowd_reader')).toBe(false);
  });

  it('is deterministic — same inputs, same decision', () => {
    for (const persona of CPU_PERSONAS) {
      const a = decideCpuPick(inputs({ persona, yesPrice: 0.37, timeToLockMs: 90_000 }));
      const b = decideCpuPick(inputs({ persona, yesPrice: 0.37, timeToLockMs: 90_000 }));
      expect(a).toEqual(b);
    }
  });
});
