/**
 * Unit coverage for the §5.7 effective-state rule (`effectiveQuestionStatus`) and the
 * draft-exclusion guard (`assertQuestionPubliclyVisible`) — no DB needed, both are pure over a
 * minimal question fixture.
 */
import { describe, expect, it } from 'vitest';
import type { QuestionRow } from '@receipts/db';
import {
  assertQuestionPubliclyVisible,
  effectiveQuestionStatus,
  serializeQuestionPeek,
} from '@/lib/serialize-question';

function question(overrides: Partial<QuestionRow>): QuestionRow {
  return {
    status: 'scheduled',
    openAt: new Date('2026-08-01T13:00:00Z'),
    lockAt: new Date('2026-08-01T16:00:00Z'),
    ...overrides,
  } as QuestionRow;
}

describe('effectiveQuestionStatus (§5.7)', () => {
  it('derives forward past a stale raw status once lock_at has passed (worker-outage tolerance)', () => {
    const q = question({ status: 'scheduled' });
    const after = new Date('2026-08-01T17:00:00Z');
    expect(effectiveQuestionStatus(q, after)).toBe('locked');
  });

  it('derives forward from scheduled to open once open_at has passed', () => {
    const q = question({ status: 'scheduled' });
    const mid = new Date('2026-08-01T14:00:00Z');
    expect(effectiveQuestionStatus(q, mid)).toBe('open');
  });

  it('never derives EARLIER than the raw status — an admin early-lock with a future lock_at stays locked', () => {
    const q = question({ status: 'locked', lockAt: new Date('2026-08-01T20:00:00Z') });
    const before = new Date('2026-08-01T14:00:00Z'); // between open_at and the (future) lock_at
    expect(effectiveQuestionStatus(q, before)).toBe('locked');
  });

  it('a raw draft never derives forward, regardless of timestamps', () => {
    const q = question({ status: 'draft' });
    const wayAfter = new Date('2026-08-02T00:00:00Z');
    expect(effectiveQuestionStatus(q, wayAfter)).toBe('draft');
  });

  it('revealed and voided are terminal — never overridden by timestamps', () => {
    const revealed = question({ status: 'revealed' });
    const voided = question({ status: 'voided' });
    const at = new Date('2026-07-01T00:00:00Z'); // well before open_at
    expect(effectiveQuestionStatus(revealed, at)).toBe('revealed');
    expect(effectiveQuestionStatus(voided, at)).toBe('voided');
  });
});

describe('assertQuestionPubliclyVisible', () => {
  it('throws NOT_FOUND for a raw draft question', () => {
    expect(() => assertQuestionPubliclyVisible({ status: 'draft' })).toThrow();
  });

  it('does not throw for any non-draft status', () => {
    for (const status of ['scheduled', 'open', 'locked', 'revealed', 'voided'] as const) {
      expect(() => assertQuestionPubliclyVisible({ status })).not.toThrow();
    }
  });
});

describe('serializeQuestionPeek (design-diff audit, §9.2 GET /questions/tomorrow)', () => {
  it('returns the narrow peek shape — status + open_at only, never a headline/price/crowd — for a raw scheduled row', () => {
    const q = question({ status: 'scheduled' });
    const at = new Date('2026-08-01T00:00:00Z'); // well before open_at
    const peek = serializeQuestionPeek(q, at);
    expect(peek).toEqual({ status: 'scheduled', open_at: q.openAt.toISOString() });
  });

  it('returns null for a draft row, regardless of timestamps (never peek an unpublished question)', () => {
    const q = question({ status: 'draft' });
    const at = new Date('2026-08-02T00:00:00Z');
    expect(serializeQuestionPeek(q, at)).toBeNull();
  });

  it('returns null once the effective status has moved past scheduled (open_at has passed) — this endpoint has no shape for "tomorrow, opened"', () => {
    const q = question({ status: 'scheduled' });
    const afterOpen = new Date('2026-08-01T14:00:00Z'); // past openAt (13:00Z)
    expect(serializeQuestionPeek(q, afterOpen)).toBeNull();
  });

  it('returns null for a raw status already past scheduled (open/locked/revealed/voided) even before its own timestamps would derive it forward', () => {
    for (const status of ['open', 'locked', 'revealed', 'voided'] as const) {
      const q = question({ status });
      const wayBefore = new Date('2026-07-01T00:00:00Z');
      expect(serializeQuestionPeek(q, wayBefore)).toBeNull();
    }
  });

  it('never leaks a headline, price, or crowd — the returned shape structurally cannot carry them', () => {
    const q = question({ status: 'scheduled', headline: 'Some future headline' });
    const peek = serializeQuestionPeek(q, new Date('2026-08-01T00:00:00Z'));
    expect(peek).not.toBeNull();
    expect(Object.keys(peek!)).toEqual(['status', 'open_at']);
  });
});
