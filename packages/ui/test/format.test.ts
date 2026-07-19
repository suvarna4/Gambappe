import { describe, expect, it } from 'vitest';

import {
  barcodePattern,
  countdownParts,
  crowdSplit,
  formatCountdown,
  HUSH_WINDOW_MS,
  impliedCents,
  isHushWindow,
} from '../src/format.js';

describe('impliedCents', () => {
  it('reads the yes side directly', () => {
    expect(impliedCents('yes', 0.63)).toBe(63);
  });

  it('reads the no side as the complement', () => {
    expect(impliedCents('no', 0.63)).toBe(37);
  });

  it('rounds to the nearest cent', () => {
    expect(impliedCents('yes', 0.625)).toBe(63);
    expect(impliedCents('yes', 0.624)).toBe(62);
  });

  it('clamps out-of-range probabilities defensively', () => {
    expect(impliedCents('yes', 1.4)).toBe(100);
    expect(impliedCents('yes', -0.2)).toBe(0);
  });
});

describe('crowdSplit', () => {
  it('splits proportionally', () => {
    expect(crowdSplit(70, 30)).toEqual({ yesPct: 70, noPct: 30 });
  });

  it('defaults to an even split before anyone has picked', () => {
    expect(crowdSplit(0, 0)).toEqual({ yesPct: 50, noPct: 50 });
  });

  it('rounds yes and derives no as the exact complement (always sums to 100)', () => {
    expect(crowdSplit(1, 2)).toEqual({ yesPct: 33, noPct: 67 });
  });
});

describe('countdownParts + formatCountdown', () => {
  it('is expired at or past the target', () => {
    const parts = countdownParts(1_000, 1_000);
    expect(parts.expired).toBe(true);
    expect(formatCountdown(parts)).toBe('0:00');
  });

  it('never goes negative past the target', () => {
    const parts = countdownParts(1_000, 5_000);
    expect(parts.totalMs).toBe(0);
  });

  it('formats minutes:seconds under an hour', () => {
    const parts = countdownParts(90_000, 0); // 1m30s
    expect(formatCountdown(parts)).toBe('1:30');
  });

  it('formats h:mm:ss under a day', () => {
    const parts = countdownParts(2 * 3600_000 + 5 * 60_000 + 9_000, 0); // 2h05m09s
    expect(formatCountdown(parts)).toBe('2:05:09');
  });

  it('formats Xd XXh at a day or beyond', () => {
    const parts = countdownParts(2 * 86_400_000 + 3 * 3600_000, 0); // 2d03h
    expect(formatCountdown(parts)).toBe('2d 03h');
  });
});

describe('isHushWindow (§2.6 F1 hush trigger math)', () => {
  it('is false well before the window', () => {
    expect(isHushWindow(100_000, 0)).toBe(false);
  });

  it('is true exactly at the window boundary (T-10s)', () => {
    expect(isHushWindow(HUSH_WINDOW_MS, 0)).toBe(true);
  });

  it('is true just inside the window', () => {
    expect(isHushWindow(HUSH_WINDOW_MS, 1)).toBe(true);
  });

  it('is false just outside the window', () => {
    expect(isHushWindow(HUSH_WINDOW_MS + 1, 0)).toBe(false);
  });

  it('is false at and after the target — hush is pre-reveal only', () => {
    expect(isHushWindow(1_000, 1_000)).toBe(false);
    expect(isHushWindow(1_000, 2_000)).toBe(false);
  });

  it('respects a custom window', () => {
    expect(isHushWindow(5_000, 0, 5_000)).toBe(true);
    expect(isHushWindow(5_001, 0, 5_000)).toBe(false);
  });
});

describe('barcodePattern', () => {
  it('is deterministic for the same path', () => {
    expect(barcodePattern('/q/2026-07-19-final')).toEqual(barcodePattern('/q/2026-07-19-final'));
  });

  it('produces bars for two different paths', () => {
    expect(barcodePattern('/q/a')).not.toEqual(barcodePattern('/q/b'));
  });

  it('respects the requested bar count', () => {
    expect(barcodePattern('/q/x', 12)).toHaveLength(12);
  });
});
