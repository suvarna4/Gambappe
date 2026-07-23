/**
 * Snapshot-guards the built prompts against accidental drift (docs/xtrace-hackathon-tasks.md
 * XH-T3 AC). Update snapshots consciously with `vitest -u` when a prompt change is deliberate.
 */
import { describe, expect, it } from 'vitest';

import { buildBanterPrompt, buildCalloutDraftPrompt, buildRecapPrompt } from '../src/prompts.js';

describe('buildBanterPrompt', () => {
  it('matches the pinned snapshot for a fixed context', () => {
    expect(
      buildBanterPrompt({
        viewerHandle: 'fox-4821',
        opponentHandle: 'kingfisher-0042',
        record: { wins: 5, losses: 3, draws: 1 },
        currentWeek: { scoreViewer: 2, scoreOpponent: 1, daysRemaining: 3 },
        lastVerdictLine: 'fox-4821 took it by a hair.',
        memory: ['kingfisher-0042 rage-quit after the last loss'],
      }),
    ).toMatchSnapshot();
  });

  it('matches the pinned snapshot with no active week or memory', () => {
    expect(
      buildBanterPrompt({
        viewerHandle: 'fox-4821',
        opponentHandle: 'kingfisher-0042',
        record: { wins: 0, losses: 0, draws: 0 },
        currentWeek: null,
        lastVerdictLine: null,
        memory: [],
      }),
    ).toMatchSnapshot();
  });
});

describe('buildCalloutDraftPrompt', () => {
  it('matches the pinned snapshot for a fixed context', () => {
    expect(
      buildCalloutDraftPrompt({
        challengerHandle: 'fox-4821',
        targetHandle: 'kingfisher-0042',
        record: { wins: 5, losses: 3, draws: 1 },
        memory: ['kingfisher-0042 rage-quit after the last loss'],
      }),
    ).toMatchSnapshot();
  });
});

describe('buildRecapPrompt', () => {
  it('matches the pinned snapshot for a fixed context', () => {
    expect(
      buildRecapPrompt({
        handle: 'fox-4821',
        seasonName: 'Season 3',
        stats: {
          pairings: 4,
          wins: 10,
          losses: 6,
          draws: 1,
          bestStreak: 5,
          calloutsSent: 3,
          calloutsWon: 2,
        },
        verdictLines: ['fox-4821 took week 1.', 'kingfisher-0042 took week 2.'],
        memory: ['a running joke about week 2'],
      }),
    ).toMatchSnapshot();
  });
});
