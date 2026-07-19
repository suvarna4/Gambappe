/**
 * SW3-T2 · `lib/obituary.ts` — pure unit coverage for the reveal-choreography obituary handoff
 * (swipe-ux-plan §2.6/§2.7). No jsdom, no React — these are plain functions over the
 * `RevealPayload.viewer` shape, same posture as `pick-client.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import type { RevealViewer } from '@receipts/core';
import { buildObituaryHandoffProps, streakBrokeThisReveal } from '@/lib/obituary';

function buildViewer(overrides: Partial<RevealViewer> = {}): RevealViewer {
  return {
    pick: {
      id: '018f1e2b-0000-7000-8000-0000000000f9' as RevealViewer['pick']['id'],
      question_id: '018f1e2b-0000-7000-8000-0000000000f8' as RevealViewer['pick']['question_id'],
      profile_id: '018f1e2b-0000-7000-8000-0000000000f7' as RevealViewer['pick']['profile_id'],
      side: 'no',
      yes_price_at_entry: 0.71,
      price_stamped_at: '2026-07-19T13:00:00Z',
      picked_at: '2026-07-19T13:00:00Z',
      source: 'spectator_page',
      confidence: null,
      result: 'loss',
      edge: -0.71,
    },
    result: 'loss',
    edge: -0.71,
    percentile: null,
    streak: { current: 0, best: 4, delta: -4, freeze_used: false },
    badges: [],
    ...overrides,
  };
}

describe('streakBrokeThisReveal', () => {
  it('true on a loss whose streak reset to 0 from a run >= OBITUARY_MIN_STREAK', () => {
    expect(streakBrokeThisReveal(buildViewer())).toBe(true);
  });

  it('false on a win, even if current/delta look broken (no losing pick to attribute it to)', () => {
    const viewer = buildViewer({ result: 'win' });
    expect(streakBrokeThisReveal(viewer)).toBe(false);
  });

  it('false when current streak did not reset to 0 (ordinary loss, streak continues)', () => {
    const viewer = buildViewer({ streak: { current: 2, best: 5, delta: 1, freeze_used: false } });
    expect(streakBrokeThisReveal(viewer)).toBe(false);
  });

  it('false when the run that just ended was below OBITUARY_MIN_STREAK (1-2 day runs are not a story)', () => {
    const viewer = buildViewer({ streak: { current: 0, best: 2, delta: -2, freeze_used: false } });
    expect(streakBrokeThisReveal(viewer)).toBe(false);
  });

  it('a freeze partially covering the gap does not exempt a real break', () => {
    const viewer = buildViewer({ streak: { current: 0, best: 6, delta: -6, freeze_used: true } });
    expect(streakBrokeThisReveal(viewer)).toBe(true);
  });
});

describe('buildObituaryHandoffProps', () => {
  it('recovers the exact broken-run length from current - delta', () => {
    const props = buildObituaryHandoffProps(buildViewer(), '2026-07-19', {
      yes: 'Yes it will',
      no: 'No it will not',
    });
    expect(props.days).toBe(4);
  });

  it('computes start/end dates by counting back `days` days from question_date', () => {
    const props = buildObituaryHandoffProps(buildViewer(), '2026-07-19', {
      yes: 'Yes it will',
      no: 'No it will not',
    });
    // 4-day run ending 2026-07-19 (Sun) started 2026-07-16 (Thu).
    expect(props.endLabel).toBe('Jul 19');
    expect(props.startLabel).toBe('Jul 16');
  });

  it('derives sideLabel/entryCents from the losing pick that ended it', () => {
    const props = buildObituaryHandoffProps(buildViewer(), '2026-07-19', {
      yes: 'Yes it will',
      no: 'No it will not',
    });
    // pick.side = 'no', yes_price_at_entry = 0.71 -> no-side implied price is 29¢.
    expect(props.sideLabel).toBe('No it will not');
    expect(props.entryCents).toBe(29);
  });

  it('no facts are fabricated — the reveal payload has no pick-log history to draw from', () => {
    const props = buildObituaryHandoffProps(buildViewer(), '2026-07-19', {
      yes: 'Yes it will',
      no: 'No it will not',
    });
    expect(props.facts).toEqual([]);
  });
});
