/**
 * WS7-T7 (duo UI) pure/presentational component render coverage — same posture as
 * `question-state-view.test.tsx`: `renderToStaticMarkup` directly, no DOM testing library
 * (§10.4: "components must be pure/presentational (props in, DOM out)"). Interactive behavior
 * (join/leave queue, disband confirm) is covered by `e2e/duo.spec.ts`.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DuoCard, type DuoPublic } from '@/components/duo/DuoCard';
import { DuoMatchHistoryList, type DuoMatchPublic } from '@/components/duo/DuoMatchHistoryList';
import { DuoLadderTable, type DuoLadderEntry } from '@/components/duo/DuoLadderTable';

const A = { profile_id: '018f1e2b-0000-7000-8000-0000000000a1', handle: 'Otter #1', slug: 'otter-1' };
const B = { profile_id: '018f1e2b-0000-7000-8000-0000000000b1', handle: 'Falcon #2', slug: 'falcon-2' };

function makeDuo(overrides: Partial<DuoPublic> = {}): DuoPublic {
  return {
    id: '018f1e2b-0000-7000-8000-0000000000d1' as DuoPublic['id'],
    status: 'active',
    tier: 2,
    partners: [A, B] as DuoPublic['partners'],
    rating: { glicko_rating: 1550.4, glicko_rd: 120 },
    matches_played: 4,
    joint_hit_rate: null,
    synergy: null,
    ...overrides,
  };
}

function makeMatch(overrides: Partial<DuoMatchPublic> = {}): DuoMatchPublic {
  return {
    id: '018f1e2b-0000-7000-8000-0000000000m1' as DuoMatchPublic['id'],
    duo_a_id: '018f1e2b-0000-7000-8000-0000000000d1' as DuoMatchPublic['duo_a_id'],
    duo_b_id: '018f1e2b-0000-7000-8000-0000000000d2' as DuoMatchPublic['duo_b_id'],
    window_start: '2026-07-14',
    window_end: '2026-07-16',
    status: 'completed',
    score: { a: 4, b: 2 },
    winner_duo_id: '018f1e2b-0000-7000-8000-0000000000d1' as DuoMatchPublic['winner_duo_id'],
    ...overrides,
  };
}

describe('DuoCard', () => {
  it('renders both partner handles, tier label, and rating', () => {
    const html = renderToStaticMarkup(<DuoCard duo={makeDuo()} />);
    expect(html).toContain('Otter #1');
    expect(html).toContain('Falcon #2');
    expect(html).toContain('Tier 2 · Carbon');
    expect(html).toContain('1550');
  });

  it('shows the chemistry-pending copy when synergy is null (below SYNERGY_MIN_PICKS)', () => {
    const html = renderToStaticMarkup(<DuoCard duo={makeDuo({ joint_hit_rate: null, synergy: null })} />);
    expect(html).toContain('Chemistry shows up once you have played more together.');
    expect(html).not.toContain('together —');
  });

  it('renders the §8.9 chemistry line once joint_hit_rate/synergy are populated', () => {
    const html = renderToStaticMarkup(
      <DuoCard duo={makeDuo({ joint_hit_rate: 0.7, synergy: 0.1 })} />,
    );
    expect(html).toContain('You two hit 70% together — better than either of you alone');
  });

  it('marks a disbanded duo without hiding its content (§9.2/INV-6: artifacts persist)', () => {
    const html = renderToStaticMarkup(<DuoCard duo={makeDuo({ status: 'disbanded' })} />);
    expect(html).toContain('Disbanded');
    expect(html).toContain('Otter #1');
  });
});

describe('DuoMatchHistoryList', () => {
  const duoId = '018f1e2b-0000-7000-8000-0000000000d1';

  it('renders the empty state when there is no history', () => {
    const html = renderToStaticMarkup(<DuoMatchHistoryList duoId={duoId} matches={[]} />);
    expect(html).toContain('No matches yet.');
  });

  it('stamps WIN when winner_duo_id matches the home duo', () => {
    const html = renderToStaticMarkup(
      <DuoMatchHistoryList duoId={duoId} matches={[makeMatch({ winner_duo_id: duoId as DuoMatchPublic['winner_duo_id'] })]} />,
    );
    expect(html).toContain('WIN');
    expect(html).toContain('4–2');
  });

  it('stamps LOSS when winner_duo_id is the other duo', () => {
    const html = renderToStaticMarkup(
      <DuoMatchHistoryList
        duoId={duoId}
        matches={[makeMatch({ winner_duo_id: '018f1e2b-0000-7000-8000-0000000000d2' as DuoMatchPublic['winner_duo_id'] })]}
      />,
    );
    expect(html).toContain('LOSS');
  });

  it('renders a draw badge for a completed match with no winner (§8.9 tie rule)', () => {
    const html = renderToStaticMarkup(
      <DuoMatchHistoryList duoId={duoId} matches={[makeMatch({ winner_duo_id: null })]} />,
    );
    expect(html).toContain('Draw');
  });

  it('marks a cancelled match without a win/loss/draw stamp', () => {
    const html = renderToStaticMarkup(
      <DuoMatchHistoryList
        duoId={duoId}
        matches={[makeMatch({ status: 'cancelled', winner_duo_id: null })]}
      />,
    );
    expect(html).toContain('Cancelled');
  });
});

describe('DuoLadderTable', () => {
  it('renders the empty state when there are no standings', () => {
    const html = renderToStaticMarkup(<DuoLadderTable entries={[]} />);
    expect(html).toContain('No duos on the ladder yet.');
  });

  it('renders rank, tier, partner handles, wins, and rating for each entry', () => {
    const entry: DuoLadderEntry = { rank: 1, tier: 1, duo: makeDuo({ tier: 1 }), wins: 7 };
    const html = renderToStaticMarkup(<DuoLadderTable entries={[entry]} />);
    expect(html).toContain('Tier 1 · Paper');
    expect(html).toContain('Otter #1');
    expect(html).toContain('Falcon #2');
    expect(html).toContain('>7<');
    expect(html).toContain('1550');
  });
});
