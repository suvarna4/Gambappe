/**
 * SW10-T2 · `NemesisHistoryList` → `VerdictCard` wiring: each row derives its `RematchVerdict`
 * from the history entry's own `outcome`/`my_score`/`their_score` (see `lib/nemesis/verdict.ts`)
 * and the per-pairing `dayResultsByPairingId` map the page fetches from `GET /pairings/:id`.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ProfileId } from '@receipts/core';
import { NemesisHistoryList } from '@/components/nemesis/NemesisHistoryList';
import type { NemesisHistoryEntry } from '@/lib/nemesis/types';

const VIEWER_ID = '018f1e2b-0000-7000-8000-0000000000v1';

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

describe('NemesisHistoryList (SW10-T2)', () => {
  it('renders a verdict card for a decisive (win/loss/draw) row', () => {
    const html = renderToStaticMarkup(
      <NemesisHistoryList viewerProfileId={VIEWER_ID} entries={[entry()]} />,
    );
    expect(html).toContain('data-testid="verdict-card"');
  });

  it('renders NO verdict card for a cancelled row — the plain fallback stays', () => {
    const html = renderToStaticMarkup(
      <NemesisHistoryList viewerProfileId={VIEWER_ID} entries={[entry({ outcome: 'cancelled' })]} />,
    );
    expect(html).not.toContain('data-testid="verdict-card"');
    expect(html).toContain('data-testid="rematch-request-button"');
    expect(html).toContain('Cancelled');
  });

  it('threads the per-pairing dayResults into the verdict card dot strip', () => {
    const html = renderToStaticMarkup(
      <NemesisHistoryList
        viewerProfileId={VIEWER_ID}
        entries={[entry()]}
        dayResultsByPairingId={{ 'p-1': ['win', 'loss', 'neutral', 'pending'] }}
      />,
    );
    // Four dots rendered means the strip actually got the array (each dot is a `<span>` inside
    // the `aria-hidden` strip — a coarse but adequate structural check for pure/presentational
    // SSR coverage, matching this file's sibling tests' posture).
    expect(html.match(/rounded-full border/g)?.length).toBe(4);
  });
});
