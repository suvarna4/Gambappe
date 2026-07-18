import { describe, expect, it } from 'vitest';
import { addDaysToDateStr, etDateString, etDayWindow, mostRecentMonday, trailingWindow } from '../src/lib/day-window.js';

describe('etDayWindow (§4.3 DST correctness)', () => {
  it('gives the EDT (UTC-4) offset in July', () => {
    const w = etDayWindow('2026-07-20');
    expect(w.start.toISOString()).toBe('2026-07-20T04:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-07-21T04:00:00.000Z');
  });

  it('gives the EST (UTC-5) offset in January', () => {
    const w = etDayWindow('2026-01-15');
    expect(w.start.toISOString()).toBe('2026-01-15T05:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-01-16T05:00:00.000Z');
  });

  it('crosses the spring-forward boundary correctly (2026-03-08, clocks spring forward at 2am ET)', () => {
    const before = etDayWindow('2026-03-07'); // still EST
    const after = etDayWindow('2026-03-08'); // now EDT
    expect(before.end.toISOString()).toBe('2026-03-08T05:00:00.000Z'); // EST midnight
    expect(after.start.toISOString()).toBe('2026-03-08T05:00:00.000Z'); // same instant, now EDT-labeled midnight
    expect(after.end.toISOString()).toBe('2026-03-09T04:00:00.000Z'); // EDT midnight
  });
});

describe('trailingWindow', () => {
  it('spans exactly N calendar days ending on (and including) the given date', () => {
    const w = trailingWindow('2026-07-20', 7);
    expect(w.start.toISOString()).toBe(etDayWindow('2026-07-14').start.toISOString());
    expect(w.end.toISOString()).toBe(etDayWindow('2026-07-20').end.toISOString());
  });
});

describe('etDateString', () => {
  it('recovers the ET calendar date from a UTC instant near midnight', () => {
    expect(etDateString(new Date('2026-07-20T04:30:00Z'))).toBe('2026-07-20'); // 00:30 ET
    expect(etDateString(new Date('2026-07-20T03:30:00Z'))).toBe('2026-07-19'); // 23:30 ET previous day
  });
});

describe('addDaysToDateStr', () => {
  it('adds and subtracts days across month/year boundaries', () => {
    expect(addDaysToDateStr('2026-07-20', 1)).toBe('2026-07-21');
    expect(addDaysToDateStr('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDaysToDateStr('2026-07-20', -1)).toBe('2026-07-19');
  });
});

describe('mostRecentMonday', () => {
  it('returns the same date when it is already a Monday', () => {
    expect(mostRecentMonday('2026-07-20')).toBe('2026-07-20');
  });

  it('walks back to the preceding Monday for other days', () => {
    expect(mostRecentMonday('2026-07-21')).toBe('2026-07-20'); // Tuesday
    expect(mostRecentMonday('2026-07-26')).toBe('2026-07-20'); // Sunday
  });
});
