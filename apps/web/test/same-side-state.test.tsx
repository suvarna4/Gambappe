/**
 * WS20-T2 (journeys-plan §5, D-J4) · The same-side card state on the matchup/verdict surfaces.
 * Pure/presentational render coverage (`renderToStaticMarkup`, node env — same posture as
 * `nemesis-flip.test.tsx`/`verdict-card.test.tsx`).
 *
 * Load-bearing assertions:
 *  - same_side present → `SameSideRow` + `TapeLabel` + the correct footer (pre-settle price edge,
 *    post-settle day-winner framing, and the inverse "theirs beats yours");
 *  - same_side absent → the opposite-side/normal card renders byte-identical to today's behavior
 *    (no `SameSideRow`, no `TapeLabel`);
 *  - no gold classnames ever reach the DOM (gold is for `called_it`/wins alone, D-SW1 — an edge
 *    win is not a gold affordance).
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ProfileId, SameSide } from '@receipts/core';
import { SameSideState } from '@/components/nemesis/SameSideState';
import { NemesisMatchupCard } from '@/components/nemesis/NemesisMatchupCard';
import { VerdictCard } from '@/components/nemesis/VerdictCard';
import type { PairingPublic, PairingSide } from '@/lib/nemesis/types';

/** The foil/gold ink surface: `text-gold`/`border-gold`/`bg-gold`, and `Stamp`'s foil gradient
 * hexes. None may appear on any same-side affordance. */
const GOLD = /\bgold\b|#B8860B|#FFC53D|#FFE9A8|#FFE9A8/i;

const YOU_CHEAPER: SameSide = { your_price: 71, their_price: 74, winner: 'you' };
const THEY_CHEAPER: SameSide = { your_price: 74, their_price: 71, winner: 'them' };

describe('SameSideState (WS20-T2, D-J4)', () => {
  it('pre-settle renders the tape, the dual-stamp row, and the price-edge footer (your cheaper entry wins)', () => {
    const html = renderToStaticMarkup(
      <SameSideState sameSide={YOU_CHEAPER} opponentHandle="Maria O." />,
    );
    expect(html).toContain('data-testid="tape-label"');
    expect(html).toContain('SAME SIDE · EDGE DECIDES');
    expect(html).toContain('data-testid="same-side-row"');
    expect(html).toContain('YOU');
    expect(html).toContain('Maria O.');
    expect(html).toContain('@ 71¢');
    expect(html).toContain('@ 74¢');
    expect(html).toContain('YOUR PRICE BEATS THEIRS BY 3¢');
    expect(html).not.toMatch(GOLD);
  });

  it('pre-settle prints the inverse footer when theirs is the better price', () => {
    const html = renderToStaticMarkup(
      <SameSideState sameSide={THEY_CHEAPER} opponentHandle="Maria O." />,
    );
    expect(html).toContain('THEIR PRICE BEATS YOURS BY 3¢');
    expect(html).not.toContain('YOUR PRICE BEATS THEIRS');
  });

  it('a same-minute price tie names the tiebreak instead of a zero margin', () => {
    const html = renderToStaticMarkup(
      <SameSideState
        sameSide={{ your_price: 70, their_price: 70, winner: 'you' }}
        opponentHandle="Maria O."
      />,
    );
    expect(html).toContain('SAME PRICE · EARLIER STAMP DECIDES');
    expect(html).not.toContain('BEATS');
  });

  it('post-settle (both right) frames the winner as calling it cheaper', () => {
    const html = renderToStaticMarkup(
      <SameSideState sameSide={YOU_CHEAPER} opponentHandle="Maria O." settled="both_right" />,
    );
    expect(html).toContain('both right — you called it cheaper');
    expect(html).not.toContain('BEATS');
    expect(html).not.toMatch(GOLD);
  });

  it('post-settle (both wrong) frames the winner as losing less', () => {
    const html = renderToStaticMarkup(
      <SameSideState sameSide={THEY_CHEAPER} opponentHandle="Maria O." settled="both_wrong" />,
    );
    expect(html).toContain('both wrong — they lost less');
    expect(html).not.toMatch(GOLD);
  });

  it('keeps caption/footer ink paper-safe on the dark stage (surface="stage" → text-paper/text-muted, never text-ink)', () => {
    const html = renderToStaticMarkup(
      <SameSideState sameSide={YOU_CHEAPER} opponentHandle="Maria O." surface="stage" />,
    );
    expect(html).toContain('text-paper');
    expect(html).toContain('text-muted');
  });
});

const A_ID = 'a1111111-0000-7000-8000-000000000000' as ProfileId;
const B_ID = 'b2222222-0000-7000-8000-000000000000' as ProfileId;
const SIDE_A: PairingSide = { profile_id: A_ID, handle: 'Fox #1', slug: 'fox-1', rating: null };
const SIDE_B: PairingSide = { profile_id: B_ID, handle: 'Owl #2', slug: 'owl-2', rating: null };

function pairing(overrides: Partial<PairingPublic> = {}): PairingPublic {
  return {
    id: 'pair-1' as PairingPublic['id'],
    season_id: 'season-1' as PairingPublic['season_id'],
    week_start: '2026-07-13',
    status: 'active',
    is_rematch: false,
    a: { profile_id: A_ID, handle: 'Fox #1', slug: 'fox-1' },
    b: { profile_id: B_ID, handle: 'Owl #2', slug: 'owl-2' },
    score: { a: 1, b: 0 },
    winner_profile_id: null,
    narrative_line: null,
    scoreboard: [],
    ...overrides,
  };
}

describe('NemesisMatchupCard × same_side (WS20-T2)', () => {
  it('renders the same-side state, naming the rival (not the viewer) as the opponent column', () => {
    const html = renderToStaticMarkup(
      <NemesisMatchupCard
        pairing={pairing()}
        sides={{ a: SIDE_A, b: SIDE_B }}
        viewerProfileId={A_ID}
        sameSide={YOU_CHEAPER}
      />,
    );
    expect(html).toContain('data-testid="same-side-state"');
    expect(html).toContain('data-testid="tape-label"');
    expect(html).toContain('data-testid="same-side-row"');
    expect(html).toContain('YOUR PRICE BEATS THEIRS BY 3¢');
    // Right-hand owner is the OTHER side (viewer is A → rival is B "Owl #2").
    expect(html).toContain('Owl #2');
    expect(html).not.toMatch(GOLD);
  });

  it('leaves the opposite-side/normal card byte-identical when same_side is absent (no tape, no row)', () => {
    const withProp = renderToStaticMarkup(
      <NemesisMatchupCard
        pairing={pairing()}
        sides={{ a: SIDE_A, b: SIDE_B }}
        viewerProfileId={A_ID}
        sameSide={null}
      />,
    );
    const without = renderToStaticMarkup(
      <NemesisMatchupCard
        pairing={pairing()}
        sides={{ a: SIDE_A, b: SIDE_B }}
        viewerProfileId={A_ID}
      />,
    );
    expect(withProp).toBe(without);
    expect(without).not.toContain('data-testid="same-side-state"');
    expect(without).not.toContain('data-testid="tape-label"');
    expect(without).not.toContain('data-testid="same-side-row"');
  });
});

describe('VerdictCard × same_side (WS20-T2)', () => {
  const base = { opponentHandle: 'Maria O.', youWins: 2, opponentWins: 3, scoreMargin: 1 } as const;

  it('renders the post-settle same-side state on the verdict face', () => {
    const html = renderToStaticMarkup(
      <VerdictCard {...base} outcome="won" sameSide={YOU_CHEAPER} sameSideSettled="both_right" />,
    );
    expect(html).toContain('data-testid="same-side-state"');
    expect(html).toContain('SAME SIDE · EDGE DECIDES');
    expect(html).toContain('both right — you called it cheaper');
    expect(html).not.toMatch(GOLD);
  });

  it('leaves the verdict card byte-identical when same_side is absent', () => {
    const withProp = renderToStaticMarkup(<VerdictCard {...base} outcome="lost" sameSide={null} />);
    const without = renderToStaticMarkup(<VerdictCard {...base} outcome="lost" />);
    expect(withProp).toBe(without);
    expect(without).not.toContain('data-testid="same-side-state"');
    expect(without).not.toContain('data-testid="tape-label"');
  });
});
