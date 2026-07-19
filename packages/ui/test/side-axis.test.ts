/** D-SW9 / swipe plan §2.2: the canonical axis-order primitives every yes/no pair renders through. */
import { describe, expect, it } from 'vitest';
import { SIDE_ORDER, sideAxisPair } from '../src/side-axis.js';

describe('SIDE_ORDER (D-SW9)', () => {
  it('is exactly no-then-yes — NO left, YES right', () => {
    expect(SIDE_ORDER).toEqual(['no', 'yes']);
  });
});

describe('sideAxisPair (D-SW9)', () => {
  it('returns the pair no-first regardless of value types', () => {
    expect(sideAxisPair('against', 'for')).toEqual(['against', 'for']);
    expect(sideAxisPair(0, 1)).toEqual([0, 1]);
  });

  it('agrees with SIDE_ORDER', () => {
    expect(sideAxisPair('no', 'yes')).toEqual([...SIDE_ORDER]);
  });
});
