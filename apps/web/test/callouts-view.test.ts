import { describe, expect, it } from 'vitest';
import type { ProfileId } from '@receipts/core';
import { aggregateGrudges } from '@/lib/callouts-view';
import type { NemesisHistoryEntry } from '@/lib/nemesis/types';

/**
 * WS20-T4 (journeys plan §5, D-J5) · The grudge-book aggregation: fold per-week nemesis history
 * entries into ONE lifetime record per rival ("they lead 2–1"), newest-first.
 */
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

describe('aggregateGrudges', () => {
  it('folds multiple weeks vs the same rival into one lifetime W–L–D record', () => {
    const grudges = aggregateGrudges([
      entry({ pairing_id: 'p-3' as NemesisHistoryEntry['pairing_id'], outcome: 'win' }),
      entry({ pairing_id: 'p-2' as NemesisHistoryEntry['pairing_id'], outcome: 'loss' }),
      entry({ pairing_id: 'p-1' as NemesisHistoryEntry['pairing_id'], outcome: 'draw' }),
    ]);
    expect(grudges).toHaveLength(1);
    expect(grudges[0]).toMatchObject({ myWins: 1, theirWins: 1, draws: 1, weeks: 3 });
  });

  it('keeps the newest pairing id as the row link target (entries are newest-first)', () => {
    const grudges = aggregateGrudges([
      entry({ pairing_id: 'p-new' as NemesisHistoryEntry['pairing_id'] }),
      entry({ pairing_id: 'p-old' as NemesisHistoryEntry['pairing_id'] }),
    ]);
    expect(grudges[0]!.latestPairingId).toBe('p-new');
  });

  it('separates distinct rivals and preserves recency order', () => {
    const grudges = aggregateGrudges([
      entry({ opponent: { profile_id: 'o-2' as ProfileId, handle: 'Badger', slug: 'badger' } }),
      entry({ opponent: { profile_id: 'o-1' as ProfileId, handle: 'Otter', slug: 'otter' } }),
    ]);
    expect(grudges.map((g) => g.opponent.profileId)).toEqual(['o-2', 'o-1']);
  });

  it('excludes cancelled weeks from the tally and from `weeks`, and drops rivals with only cancels', () => {
    const grudges = aggregateGrudges([
      entry({ opponent: { profile_id: 'o-9' as ProfileId, handle: 'Ghost', slug: 'ghost' }, outcome: 'cancelled' }),
    ]);
    expect(grudges).toEqual([]);
  });

  it('prefers an actionable incoming-open rematch request over an older terminal one', () => {
    const incoming = {
      id: 'r-1' as NonNullable<NemesisHistoryEntry['rematch_request']>['id'],
      direction: 'incoming' as const,
      status: 'open' as const,
    };
    const grudges = aggregateGrudges([
      entry({ pairing_id: 'p-2' as NemesisHistoryEntry['pairing_id'], rematch_request: null }),
      entry({ pairing_id: 'p-1' as NemesisHistoryEntry['pairing_id'], rematch_request: incoming }),
    ]);
    expect(grudges[0]!.rematchRequest).toEqual(incoming);
  });
});
