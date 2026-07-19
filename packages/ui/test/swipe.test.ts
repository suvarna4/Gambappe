/**
 * SW1-T2 · Pure gesture math + guardrail logic (swipe-ux-plan §2.3, §2.8). No DOM — pointer
 * behavior itself is covered by the SW1-T5 Playwright suite.
 */
import { describe, expect, it } from 'vitest';

import {
  COMMIT_THRESHOLD_RATIO,
  dragProgress,
  dragSide,
  hintsHidden,
  isCommit,
  LEARNED_PICKS,
  MAX_TILT_DEG,
  railsFaded,
  railsOpacity,
  shouldNudge,
  stampScale,
  STAMP_SCALE_FROM,
  tiltDeg,
  tintOpacity,
} from '../src/swipe.js';

describe('dragSide (D-SW9 axis)', () => {
  it('right is YES/for, left is NO/against', () => {
    expect(dragSide(50)).toBe('yes');
    expect(dragSide(-50)).toBe('no');
    expect(dragSide(0)).toBe('no'); // at rest defaults to against; no side is shown at progress 0
  });
});

describe('dragProgress + isCommit', () => {
  const width = 200; // threshold = 200 * 0.36 = 72px
  it('is 0 at rest and 1 exactly at the 36% threshold', () => {
    expect(dragProgress(0, width)).toBe(0);
    expect(dragProgress(width * COMMIT_THRESHOLD_RATIO, width)).toBeCloseTo(1, 10);
  });
  it('commits at or past the threshold, not before', () => {
    expect(isCommit(dragProgress(71, width))).toBe(false);
    expect(isCommit(dragProgress(72, width))).toBe(true);
    expect(isCommit(dragProgress(-72, width))).toBe(true); // symmetric for left
    expect(isCommit(dragProgress(200, width))).toBe(true);
  });
  it('guards a zero/unknown width so an unmeasured card cannot commit', () => {
    expect(dragProgress(500, 0)).toBe(0);
    expect(isCommit(dragProgress(500, 0))).toBe(false);
  });
});

describe('tiltDeg', () => {
  it('clamps to ±MAX_TILT_DEG', () => {
    expect(tiltDeg(10000)).toBe(MAX_TILT_DEG);
    expect(tiltDeg(-10000)).toBe(-MAX_TILT_DEG);
    expect(tiltDeg(0)).toBe(0);
  });
});

describe('stampScale', () => {
  it('starts at STAMP_SCALE_FROM and eases to 1 at/after the threshold', () => {
    expect(stampScale(0)).toBeCloseTo(STAMP_SCALE_FROM, 10);
    expect(stampScale(1)).toBeCloseTo(1, 10);
    expect(stampScale(2)).toBeCloseTo(1, 10); // clamped past threshold
  });
});

describe('tintOpacity', () => {
  it('ramps 0 → 0.85, capped at the threshold', () => {
    expect(tintOpacity(0)).toBe(0);
    expect(tintOpacity(0.5)).toBeCloseTo(0.425, 10);
    expect(tintOpacity(1)).toBeCloseTo(0.85, 10);
    expect(tintOpacity(5)).toBeCloseTo(0.85, 10);
  });
});

describe('guardrails (D-SW7)', () => {
  it('rails/hints fade only at LEARNED_PICKS and beyond', () => {
    expect(railsFaded(LEARNED_PICKS - 1)).toBe(false);
    expect(railsFaded(LEARNED_PICKS)).toBe(true);
    expect(hintsHidden(LEARNED_PICKS)).toBe(true);
    expect(railsOpacity(0)).toBe(1);
    expect(railsOpacity(LEARNED_PICKS)).toBe(0.4);
  });

  it('nudges only on an open question, before first throw, once per session', () => {
    expect(shouldNudge({ isOpen: true, hasThrownEver: false, nudgedThisSession: false })).toBe(
      true,
    );
    expect(shouldNudge({ isOpen: false, hasThrownEver: false, nudgedThisSession: false })).toBe(
      false,
    );
    expect(shouldNudge({ isOpen: true, hasThrownEver: true, nudgedThisSession: false })).toBe(
      false,
    );
    expect(shouldNudge({ isOpen: true, hasThrownEver: false, nudgedThisSession: true })).toBe(
      false,
    );
  });
});
