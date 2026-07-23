import { describe, expect, it } from 'vitest';

import { filterLines } from '../src/filter.js';

describe('filterLines', () => {
  it('keeps clean lines, trimmed', () => {
    expect(filterLines(['  clean rivalry banter  '])).toEqual(['clean rivalry banter']);
  });

  it('drops a line containing a dollar amount', () => {
    expect(filterLines(['you owe me $50', 'clean line'])).toEqual(['clean line']);
  });

  it('drops "bet" and its morphological variants', () => {
    for (const line of [
      "don't bet against me",
      'no more betting',
      'those bets never land',
      'stop wagering on losses',
      'you staked everything',
    ]) {
      expect(filterLines([line, 'clean line'])).toEqual(['clean line']);
    }
  });

  it('drops empty/whitespace-only lines', () => {
    expect(filterLines(['', '   ', 'clean line'])).toEqual(['clean line']);
  });

  it('returns [] when every line is filtered', () => {
    expect(filterLines(['bet it all', '$100'])).toEqual([]);
  });
});
