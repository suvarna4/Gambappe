import { describe, expect, it } from 'vitest';
import { addDaysToDateString, isoWeekMonday } from '../src/et-date.js';

describe('isoWeekMonday', () => {
  it('returns the same date when already a Monday', () => {
    expect(isoWeekMonday('2026-09-07')).toBe('2026-09-07'); // a Monday
  });

  it('normalizes a mid-week date to that week\'s Monday', () => {
    expect(isoWeekMonday('2026-09-09')).toBe('2026-09-07'); // Wednesday -> Monday
  });

  it('normalizes a Sunday to the Monday that started its (ISO) week', () => {
    expect(isoWeekMonday('2026-09-13')).toBe('2026-09-07'); // Sunday -> the same week's Monday
  });
});

describe('addDaysToDateString', () => {
  it('adds and subtracts days across a month boundary', () => {
    expect(addDaysToDateString('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDaysToDateString('2026-09-01', -1)).toBe('2026-08-31');
  });
});
