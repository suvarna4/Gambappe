import { describe, expect, it } from 'vitest';

import { getRumorRadar } from '@/lib/rumor-radar';

/**
 * WS27-T8: the panel's committed snapshot data must stay a coherent pair of probability
 * distributions — this is the tripwire for a bad regeneration of rumor-radar-data.json.
 */
describe('getRumorRadar', () => {
  const view = getRumorRadar();

  it('both sides are probability distributions over the same teams', () => {
    const crowdSum = view.rows.reduce((s, r) => s + r.crowd, 0);
    const marketSum = view.rows.reduce((s, r) => s + r.market, 0);
    expect(crowdSum).toBeCloseTo(1, 6);
    expect(marketSum).toBeCloseTo(1, 6);
    expect(new Set(view.rows.map((r) => r.team)).size).toBe(view.rows.length);
    for (const r of view.rows) {
      expect(r.team).toMatch(/^[A-Z]{3}$/);
      expect(r.name.length).toBeGreaterThan(0);
      expect(r.crowd).toBeGreaterThanOrEqual(0);
      expect(r.market).toBeGreaterThanOrEqual(0);
    }
  });

  it('rows are market-descending and the metadata is sane', () => {
    for (let i = 1; i < view.rows.length; i++) {
      expect(view.rows[i]!.market).toBeLessThanOrEqual(view.rows[i - 1]!.market);
    }
    expect(view.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(view.resolvesBy > view.date).toBe(true);
    expect(view.kl).toBeGreaterThanOrEqual(0);
    expect(view.threads).toBeGreaterThan(0);
    expect(view.comments).toBeGreaterThan(view.threads);
    expect(typeof view.topPickAgrees).toBe('boolean');
  });
});

describe('RumorRadar server render (WS27-T8)', () => {
  it('renders viewer-free static markup with both distributions', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { RumorRadar } = await import('@/components/crowd/RumorRadar');
    const { createElement } = await import('react');
    const view = getRumorRadar();
    const html = renderToStaticMarkup(createElement(RumorRadar, { view }));
    expect(html).toContain('data-testid="rumor-radar"');
    expect(html).toContain('MIA');
    expect(html).toContain(view.date);
    // Byte-identical across renders — nothing viewer- or time-dependent (INV-10).
    expect(renderToStaticMarkup(createElement(RumorRadar, { view }))).toBe(html);
  });
});
