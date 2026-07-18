import { describe, expect, it } from 'vitest';
import type { QuestionPublic } from '@receipts/core';
import { describeQuestionState } from '@/lib/question-meta';

const base: QuestionPublic = {
  id: '018f1e2b-0000-7000-8000-000000000001' as QuestionPublic['id'],
  slug: 'test-question',
  kind: 'daily',
  status: 'open',
  question_date: '2026-07-19',
  headline: 'Will it happen?',
  blurb: null,
  yes_label: 'Yes',
  no_label: 'No',
  open_at: '2026-07-19T13:00:00Z',
  lock_at: '2026-07-19T16:00:00Z',
  reveal_at: '2026-07-20T00:00:00Z',
  yes_price: 0.63,
  yes_price_updated_at: '2026-07-19T13:00:00Z',
  crowd: null,
  outcome: null,
  revealed_at: null,
  void_reason: null,
  is_volatile: false,
  venue: 'kalshi',
  venue_url: 'https://kalshi.example/markets/test',
};

describe('describeQuestionState (§10.5 og:description)', () => {
  it('scheduled: mentions the open time', () => {
    expect(describeQuestionState({ ...base, status: 'scheduled' })).toMatch(/Opens at/);
  });

  it('open: mentions the lock time, never a live crowd number (§9.3)', () => {
    const desc = describeQuestionState({ ...base, status: 'open' });
    expect(desc).toMatch(/locks at/);
    expect(desc).not.toMatch(/crowd/i);
  });

  it('locked: mentions the crowd split when present', () => {
    const desc = describeQuestionState({
      ...base,
      status: 'locked',
      crowd: { yes: 63, no: 37, pct_yes: 63 },
    });
    expect(desc).toContain('63%');
  });

  it('locked: degrades gracefully with no crowd snapshot', () => {
    const desc = describeQuestionState({ ...base, status: 'locked', crowd: null });
    expect(desc).toMatch(/Locked/);
  });

  it('revealed: names the winning label', () => {
    const desc = describeQuestionState({
      ...base,
      status: 'revealed',
      outcome: 'yes',
      crowd: { yes: 63, no: 37, pct_yes: 63 },
    });
    expect(desc).toContain('Yes');
    expect(desc).toContain('63%');
  });

  it('voided: the streak-safe explainer', () => {
    expect(describeQuestionState({ ...base, status: 'voided' })).toMatch(/Voided/);
  });
});
