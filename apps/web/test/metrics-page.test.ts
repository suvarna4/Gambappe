import { describe, expect, it } from 'vitest';
import { summarizeMetrics, type MetricRollupLike } from '../lib/metrics-page';

const WINDOWS = [
  { label: '7d', days: 7 },
  { label: '28d', days: 28 },
];

function row(date: string, metric: string, value: number, dims: Record<string, unknown> = {}): MetricRollupLike {
  return { date, metric, value, dims };
}

describe('summarizeMetrics (§16.3)', () => {
  it('averages a single-series metric over each window', () => {
    const rows = [
      row('2026-07-14', 'dau', 10),
      row('2026-07-15', 'dau', 20),
      row('2026-07-16', 'dau', 30),
    ];
    const [summary] = summarizeMetrics(rows, WINDOWS, '2026-07-16');
    expect(summary!.windows['7d']?.average).toBeCloseTo(20, 6); // (10+20+30)/3
    expect(summary!.windows['7d']?.days).toBe(3);
    expect(summary!.latestValue).toBe(30);
    expect(summary!.latestDate).toBe('2026-07-16');
  });

  it('excludes rows outside the window even when passed in', () => {
    const rows = [
      row('2026-06-01', 'dau', 999), // way outside any window
      row('2026-07-16', 'dau', 30),
    ];
    const [summary] = summarizeMetrics(rows, WINDOWS, '2026-07-16');
    expect(summary!.windows['7d']?.average).toBe(30);
    expect(summary!.windows['7d']?.days).toBe(1);
  });

  it('keeps separate dims rows (e.g. per claim-prompt trigger) as separate series', () => {
    const rows = [
      row('2026-07-16', 'ghost_claim_conversion', 0.5, { trigger: 'streak_reminder' }),
      row('2026-07-16', 'ghost_claim_conversion', 1.0, { trigger: 'reveal_wall' }),
    ];
    const summaries = summarizeMetrics(rows, WINDOWS, '2026-07-16');
    expect(summaries).toHaveLength(2);
    const streak = summaries.find((s) => s.dims['trigger'] === 'streak_reminder');
    const reveal = summaries.find((s) => s.dims['trigger'] === 'reveal_wall');
    expect(streak?.latestValue).toBe(0.5);
    expect(reveal?.latestValue).toBe(1.0);
  });

  it('returns null for a window with no data at all', () => {
    const rows = [row('2026-07-16', 'dau', 5)];
    const [summary] = summarizeMetrics(rows, [{ label: '90d', days: 90 }], '2026-05-01');
    expect(summary!.windows['90d']).toBeNull();
    expect(summary!.latestValue).toBe(5); // latest is independent of the requested windows
  });

  it('sorts summaries by metric then series key for stable rendering', () => {
    const rows = [
      row('2026-07-16', 'wau', 5),
      row('2026-07-16', 'activation_rate', 0.3),
    ];
    const summaries = summarizeMetrics(rows, WINDOWS, '2026-07-16');
    expect(summaries.map((s) => s.metric)).toEqual(['activation_rate', 'wau']);
  });

  it('computes independent 7d vs 28d averages when data spans both windows differently', () => {
    const rows = [
      row('2026-06-20', 'dau', 100), // only inside 28d
      row('2026-07-14', 'dau', 10), // inside both
      row('2026-07-15', 'dau', 20), // inside both
      row('2026-07-16', 'dau', 30), // inside both
    ];
    const [summary] = summarizeMetrics(rows, WINDOWS, '2026-07-16');
    expect(summary!.windows['7d']?.average).toBeCloseTo(20, 6); // (10+20+30)/3
    expect(summary!.windows['28d']?.average).toBeCloseTo(40, 6); // (100+10+20+30)/4
  });
});
