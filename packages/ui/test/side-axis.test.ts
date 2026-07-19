// SW0-T2 · The side-axis rule (swipe-ux-plan §2.2, D-SW9): NO/against left, YES/for right.
import { describe, expect, it } from 'vitest';

import { SIDE_ORDER, sideAxisIndex, sideAxisPair } from '../src/side-axis.js';

describe('SIDE_ORDER', () => {
  it('is against-then-for, left to right', () => {
    expect(SIDE_ORDER).toEqual(['no', 'yes']);
  });

  it('puts no strictly left of yes', () => {
    expect(SIDE_ORDER.indexOf('no')).toBeLessThan(SIDE_ORDER.indexOf('yes'));
  });
});

describe('sideAxisPair', () => {
  it('returns [no, yes] regardless of value types', () => {
    expect(sideAxisPair('HOLDS', 'CUTS')).toEqual(['HOLDS', 'CUTS']);
    expect(sideAxisPair(0, 1)).toEqual([0, 1]);
  });

  it('the first element is always the against value', () => {
    const [left, right] = sideAxisPair({ side: 'no' }, { side: 'yes' });
    expect(left.side).toBe('no');
    expect(right.side).toBe('yes');
  });
});

describe('sideAxisIndex', () => {
  it('maps no to 0 (left) and yes to 1 (right)', () => {
    expect(sideAxisIndex('no')).toBe(0);
    expect(sideAxisIndex('yes')).toBe(1);
  });
});
