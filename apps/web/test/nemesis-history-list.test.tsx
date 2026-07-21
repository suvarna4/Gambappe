/**
 * `NemesisHistoryList` — plain compact past-record rows (design-diff audit: no head-to-head
 * banner, no verdict swipe card, no rematch-request affordance — see the component's own header
 * for why those were dropped for this route).
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ProfileId } from '@receipts/core';
import { NemesisHistoryList } from '@/components/nemesis/NemesisHistoryList';
import type { NemesisHistoryEntry } from '@/lib/nemesis/types';

function entry(overrides: Partial<NemesisHistoryEntry> = {}): NemesisHistoryEntry {
  return {
    pairing_id: 'p-1' as NemesisHistoryEntry['pairing_id'],
    season_id: 's-1' as NemesisHistoryEntry['season_id'],
    week_start: '2026-06-01',
    opponent: { profile_id: 'o-1' as ProfileId, handle: 'Otter #9001', slug: 'otter' },
    my_score: 4,
    their_score: 1,
    outcome: 'win',
    is_rematch: false,
    rematch_request: null,
    ...overrides,
  };
}

describe('NemesisHistoryList', () => {
  it('renders the empty-state copy when there are no entries', () => {
    const html = renderToStaticMarkup(<NemesisHistoryList entries={[]} />);
    expect(html.toLowerCase()).toContain('no nemesis history');
  });

  it('renders a compact row: opponent link, score, week, and an outcome badge', () => {
    const html = renderToStaticMarkup(<NemesisHistoryList entries={[entry()]} />);
    expect(html).toContain('href="/vs/p-1"');
    expect(html).toContain('Otter #9001');
    expect(html).toContain('4–1');
    expect(html).toContain('week of 2026-06-01');
  });

  it('marks a rematch week', () => {
    const html = renderToStaticMarkup(<NemesisHistoryList entries={[entry({ is_rematch: true })]} />);
    expect(html).toContain('rematch');
  });

  it('renders no head-to-head banner, verdict card, or rematch-request affordance', () => {
    const html = renderToStaticMarkup(<NemesisHistoryList entries={[entry()]} />);
    expect(html).not.toContain('data-testid="head-to-head-banner"');
    expect(html).not.toContain('data-testid="verdict-card"');
    expect(html).not.toContain('data-testid="rematch-request-button"');
  });

  it('shows the Cancelled label for a cancelled row instead of a win/loss/draw badge', () => {
    const html = renderToStaticMarkup(<NemesisHistoryList entries={[entry({ outcome: 'cancelled' })]} />);
    expect(html).toContain('Cancelled');
  });
});
