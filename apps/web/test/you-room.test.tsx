/**
 * WS22-T1 · Unit tests for the `/you` record-room compositions (`YouRoomClaimed`/`YouRoomGhost`,
 * journeys plan §5). Node env → static-markup assertions (the DB/identity wiring is exercised by
 * the e2e suite). Pins the AC-visible bits: the claimed room links out to `/p/{slug}` + `/settings`
 * and shows the reused stat grid; the ghost room shows forming placeholders, the reserved
 * `you-save-row-slot`, and the `TopicFollowChips` — and never a gold ask (D-J8).
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MARKET_CATEGORY } from '@receipts/core';
import { YouRoomClaimed, YouRoomGhost } from '@/components/profile/YouRoom';

describe('YouRoomClaimed', () => {
  const base = {
    handle: 'ACE#1234',
    slug: 'ace-1234',
    currentStreak: 5,
    bestStreak: 9,
    currentWinStreak: 3,
    bestWinStreak: 7,
    freezeBank: 2,
    accuracyPercentile: 88 as number | null,
    walletVerified: false,
    rating: 1500 as number | null,
    nemesis: { wins: 4, losses: 2, draws: 1 },
    badges: [] as string[],
    categoryShares: { sports: 0.6, politics: 0.4 },
    graveyard: { rip: [4, 3], called_it_count: 1 },
  };

  it('renders the claimed record with the handle, stats, topic bars and graveyard', () => {
    const html = renderToStaticMarkup(<YouRoomClaimed {...base} />);
    expect(html).toContain('data-testid="you-claimed"');
    expect(html).toContain('ACE#1234');
    expect(html).toContain('Top 12% accuracy'); // 100 − 88
    expect(html).toContain('(best 9)'); // reused stat grid
    expect(html).toContain('data-testid="profile-topic-bars"');
    expect(html).toContain('data-testid="graveyard-shelf"');
    // The streak-freeze note (the `/you`-only header extra).
    expect(html).toContain('2 freezes banked');
  });

  it('links out to the public profile and settings', () => {
    const html = renderToStaticMarkup(<YouRoomClaimed {...base} />);
    expect(html).toContain('href="/p/ace-1234"');
    expect(html).toContain('href="/settings"');
    expect(html).toContain('View public profile');
  });

  it('omits the graveyard shelf when there is nothing to shelve', () => {
    const html = renderToStaticMarkup(<YouRoomClaimed {...base} graveyard={null} />);
    expect(html).not.toContain('data-testid="graveyard-shelf"');
  });
});

describe('YouRoomGhost', () => {
  it('renders the forming room: placeholder stats, the save-row slot, and topic chips', () => {
    const html = renderToStaticMarkup(<YouRoomGhost followed={['sports']} />);
    expect(html).toContain('data-testid="you-ghost"');
    // Forming placeholders — the reused stat grid in its `forming` state.
    expect(html.match(/—/g)?.length).toBe(4);
    // The reserved slot WS21-T2's save row fills.
    expect(html).toContain('data-testid="you-save-row-slot"');
    // The ghost-allowed follow chips, seeded with the ghost's followed set.
    expect(html).toContain('data-testid="topic-follow-chips"');
    for (const category of MARKET_CATEGORY) {
      expect(html).toContain(`data-testid="topic-chip-${category}"`);
    }
    expect(html).toMatch(/topic-chip-sports"[^>]*aria-pressed="true"/);
    // No gold ask anywhere in the ghost room (D-J8 — the save row owns the ask, and it's neutral).
    expect(html).not.toContain('gold');
  });

  it('starts from an empty follow set for a fully anonymous visitor', () => {
    const html = renderToStaticMarkup(<YouRoomGhost followed={[]} />);
    expect(html).toContain('data-testid="you-save-row-slot"');
    expect(html).toMatch(/topic-chip-sports"[^>]*aria-pressed="false"/);
  });
});
