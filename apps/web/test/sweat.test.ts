import { describe, expect, it } from 'vitest';
import {
  heldSideDrift,
  impliedHeldCents,
  settleWhenLabel,
  SETTLE_WHEN_ORDER,
} from '@/lib/sweat';

/** WS19-T2 · the settle-when label + held-side drift maths (`docs/journeys-plan.md` §5, D-J3). */
describe('settleWhenLabel', () => {
  const now = Date.parse('2026-07-21T12:00:00Z');

  it('labels a market closing within 2h as LIVE', () => {
    const label = settleWhenLabel('2026-07-21T13:00:00Z', now);
    expect(label).toEqual({ kind: 'live', text: 'LIVE' });
  });

  it('labels an already-closed (settling) market as LIVE', () => {
    const label = settleWhenLabel('2026-07-21T09:00:00Z', now);
    expect(label.kind).toBe('live');
    expect(label.text).toBe('LIVE');
  });

  it('labels a market closing within 7 days with a short uppercase weekday', () => {
    const label = settleWhenLabel('2026-07-24T18:00:00Z', now);
    expect(label.kind).toBe('weekday');
    expect(label.text).toMatch(/^(MON|TUE|WED|THU|FRI|SAT|SUN)$/);
  });

  it('labels a far-off market with an approximate ~MON YYYY month/year', () => {
    const label = settleWhenLabel('2026-11-15T18:00:00Z', now);
    expect(label.kind).toBe('month');
    expect(label.text).toMatch(/^~[A-Z]{3} \d{4}$/);
    expect(label.text).toBe('~NOV 2026');
  });

  it('orders soonest-first: live before weekday before month', () => {
    expect(SETTLE_WHEN_ORDER.live).toBeLessThan(SETTLE_WHEN_ORDER.weekday);
    expect(SETTLE_WHEN_ORDER.weekday).toBeLessThan(SETTLE_WHEN_ORDER.month);
  });
});

describe('impliedHeldCents', () => {
  it('is the raw yes price for a YES pick', () => {
    expect(impliedHeldCents('yes', 0.63)).toBe(63);
  });
  it('is 100 − yes price for a NO pick', () => {
    expect(impliedHeldCents('no', 0.63)).toBe(37);
  });
});

describe('heldSideDrift', () => {
  it('is positive/up when a YES holder’s side gets more likely', () => {
    expect(heldSideDrift('yes', 0.6, 0.65)).toEqual({ cents: 5, direction: 'up' });
  });

  it('is negative/down for a NO holder when yes rises (their side got less likely)', () => {
    // held(no) entry = 40¢, now = 35¢ → −5¢.
    expect(heldSideDrift('no', 0.6, 0.65)).toEqual({ cents: -5, direction: 'down' });
  });

  it('is flat at zero movement', () => {
    expect(heldSideDrift('yes', 0.6, 0.6)).toEqual({ cents: 0, direction: 'flat' });
  });

  it('is unknown (null cents) when no live price is available', () => {
    expect(heldSideDrift('yes', 0.6, null)).toEqual({ cents: null, direction: 'unknown' });
  });
});
