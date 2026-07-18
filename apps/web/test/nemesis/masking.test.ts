import { describe, expect, it } from 'vitest';
import { isLocked, toScoreboardRow, type SharedQuestionRecord } from '../../lib/nemesis/masking';

const NOW = new Date('2026-07-18T12:00:00.000Z');

function record(overrides: Partial<SharedQuestionRecord> = {}): SharedQuestionRecord {
  return {
    question_id: '00000000-0000-4000-8000-000000000101',
    slug: 'mock-q',
    kind: 'daily',
    question_date: '2026-07-15',
    lock_at: '2026-07-18T11:00:00.000Z', // 1h before NOW by default
    a: { side: 'yes', result: 'win' },
    b: { side: 'no', result: 'loss' },
    ...overrides,
  };
}

describe('isLocked', () => {
  it('is true once lock_at has passed', () => {
    expect(isLocked('2026-07-18T11:00:00.000Z', NOW)).toBe(true);
  });

  it('is true exactly at lock_at (§6.2: lock is a <= boundary, not <)', () => {
    expect(isLocked('2026-07-18T12:00:00.000Z', NOW)).toBe(true);
  });

  it('is false before lock_at', () => {
    expect(isLocked('2026-07-18T13:00:00.000Z', NOW)).toBe(false);
  });
});

describe('toScoreboardRow (§9.3 masking)', () => {
  it('reveals both sides once the question has locked', () => {
    const row = toScoreboardRow(record(), NOW);
    expect(row.a).toEqual({ side: 'yes', result: 'win' });
    expect(row.b).toEqual({ side: 'no', result: 'loss' });
  });

  it('masks BOTH sides pre-lock, even though the underlying picks exist', () => {
    const row = toScoreboardRow(record({ lock_at: '2026-07-18T13:00:00.000Z' }), NOW);
    expect(row.a).toBeNull();
    expect(row.b).toBeNull();
  });

  it('masking is viewer-independent — there is no viewer parameter at all', () => {
    // The function signature itself proves this (no profile id accepted); this test just
    // pins the masked shape so a future edit can't quietly add viewer-conditional behavior
    // and violate INV-10 (server-rendered payload must be viewer-free).
    const row = toScoreboardRow(record({ lock_at: '2026-07-18T13:00:00.000Z' }), NOW);
    expect(Object.keys(row).sort()).toEqual([
      'a',
      'b',
      'kind',
      'question_date',
      'question_id',
      'slug',
    ]);
  });

  it('passes through question_id/slug/kind/question_date unmodified', () => {
    const row = toScoreboardRow(record({ kind: 'nemesis_bonus', question_date: null }), NOW);
    expect(row.question_id).toBe('00000000-0000-4000-8000-000000000101');
    expect(row.slug).toBe('mock-q');
    expect(row.kind).toBe('nemesis_bonus');
    expect(row.question_date).toBeNull();
  });

  it('preserves a null pick (no pick made) distinctly from a masked pick, once locked', () => {
    const row = toScoreboardRow(record({ b: null }), NOW);
    expect(row.a).not.toBeNull();
    expect(row.b).toBeNull();
  });
});
