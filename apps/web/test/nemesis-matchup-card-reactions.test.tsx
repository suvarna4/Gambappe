/**
 * SW10-T4 (wiring-gaps doc §4): `NemesisMatchupCard`'s `ReactionStamps` wiring, pure/
 * presentational render coverage (`renderToStaticMarkup`, no DOM interaction library — same
 * posture as `nemesis-components.test.tsx`/`duo-components.test.tsx`).
 *
 * The load-bearing assertion here is INV-10: `renderToStaticMarkup` performs a single
 * synchronous pass with no `useEffect` — so `ReactionStampsPanel`'s `fetchMe()` effect never
 * runs, `me` stays `{status: 'loading'}`, and the interactive picker renders nothing. This is a
 * structural proof (not just an assertion) that the viewer's own `selected` stamp can never
 * appear in this component's server render, on EITHER page it mounts on — this test doesn't even
 * need to vary `viewerProfileId` to demonstrate it, which is itself the point (see
 * `ReactionStampsPanel`'s own header comment).
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ProfileId } from '@receipts/core';
import { NemesisMatchupCard } from '@/components/nemesis/NemesisMatchupCard';
import type { PairingPublic, PairingSide } from '@/lib/nemesis/types';

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

describe('NemesisMatchupCard × ReactionStamps (SW10-T4)', () => {
  it('renders read-only per-side stamps straight off today_reactions, no <button> anywhere (server-safe)', () => {
    const html = renderToStaticMarkup(
      <NemesisMatchupCard
        pairing={pairing({ today_reactions: { a: 'Sweating?', b: 'Respect' } })}
        sides={{ a: SIDE_A, b: SIDE_B }}
        viewerProfileId={null}
      />,
    );
    expect(html).toContain('Sweating?');
    expect(html).toContain('Respect');
    // Read-only ReactionStamps never renders a <button> (matches ReactionStamps' own contract).
    expect(html).not.toContain('<button');
  });

  it('renders neither side\'s stamp block when today_reactions is absent (nullish field, degrade by omission)', () => {
    const html = renderToStaticMarkup(
      <NemesisMatchupCard pairing={pairing()} sides={{ a: SIDE_A, b: SIDE_B }} viewerProfileId={null} />,
    );
    expect(html).not.toContain('data-testid="reaction-stamps"');
  });

  it('never renders the interactive picker or leaks viewer identity server-side, even for a real participant viewerProfileId (INV-10)', () => {
    const html = renderToStaticMarkup(
      <NemesisMatchupCard
        pairing={pairing({ today_reactions: { a: 'Lucky', b: null } })}
        sides={{ a: SIDE_A, b: SIDE_B }}
        // Even the /nemesis (force-dynamic, real-viewer) posture must never server-render the
        // interactive panel — `ReactionStampsPanel` derives everything post-hydration.
        viewerProfileId={A_ID}
      />,
    );
    expect(html).not.toContain('data-testid="reaction-stamps-panel"');
    expect(html).not.toContain('<button');
  });

  it('the two sides\' stamps are byte-identical for a null viewerProfileId vs a real one (INV-10 on the read half)', () => {
    const p = pairing({ today_reactions: { a: 'Called it', b: 'Sweating?' } });
    const spectator = renderToStaticMarkup(
      <NemesisMatchupCard pairing={p} sides={{ a: SIDE_A, b: SIDE_B }} viewerProfileId={null} />,
    );
    const asParticipant = renderToStaticMarkup(
      <NemesisMatchupCard pairing={p} sides={{ a: SIDE_A, b: SIDE_B }} viewerProfileId={A_ID} />,
    );
    // Not byte-identical overall (the "You" label swap is deliberately viewer-relative, per
    // this component's own header comment) — but the reaction-stamp markup itself must match.
    const countStampMounts = (html: string) => (html.match(/data-testid="reaction-stamps"/g) ?? []).length;
    expect(countStampMounts(spectator)).toBe(2); // one read-only mount per side
    expect(countStampMounts(spectator)).toBe(countStampMounts(asParticipant));
  });
});
