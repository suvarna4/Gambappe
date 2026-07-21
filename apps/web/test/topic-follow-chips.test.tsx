/**
 * WS18-T2 · `TopicFollowChips` unit test. Node env → static-markup assertions on the initial
 * render (the optimistic toggle/rollback is exercised end-to-end by WS18-T3/WS23-T1 e2e). Pins:
 * one chip per market category, the followed set reflected in `aria-pressed` + the neutral
 * (non-gold) on-style, counts rendered when supplied, and the read-only (disabled) variant.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MARKET_CATEGORY } from '@receipts/core';

import { TopicFollowChips } from '@/components/TopicFollowChips';

describe('TopicFollowChips', () => {
  it('renders one chip per category, marking followed ones aria-pressed with no gold', () => {
    const html = renderToStaticMarkup(
      <TopicFollowChips initialFollowed={['economics', 'sports']} />,
    );
    for (const category of MARKET_CATEGORY) {
      expect(html).toContain(`data-testid="topic-chip-${category}"`);
    }
    // followed → aria-pressed true + bright paper ink; unfollowed → muted.
    expect(html).toMatch(/topic-chip-economics"[^>]*aria-pressed="true"/);
    expect(html).toMatch(/topic-chip-culture"[^>]*aria-pressed="false"/);
    expect(html).toContain('border-paper');
    expect(html).not.toContain('gold'); // D-J8: gold is for wins, never an ambient control
  });

  it('renders open-topic counts when provided', () => {
    const html = renderToStaticMarkup(
      <TopicFollowChips initialFollowed={[]} counts={{ economics: 3, sports: 0 }} />,
    );
    expect(html).toContain('Economics · 3');
    expect(html).toContain('Sports · 0');
    // categories without a count render bare.
    expect(html).toContain('>Culture<');
  });

  it('disables every chip in the read-only variant', () => {
    const html = renderToStaticMarkup(<TopicFollowChips initialFollowed={['other']} disabled />);
    const disabledCount = (html.match(/disabled=""/g) ?? []).length;
    expect(disabledCount).toBe(MARKET_CATEGORY.length);
  });
});
