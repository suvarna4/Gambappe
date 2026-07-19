/**
 * WS5-T3 (§13.3): pure unit tests for `deriveNemesisVerdictBeats` — the beat-selection logic
 * `nemesis:conclude` hooks into. Deliberately DB-free, mirroring `reveal-beats.test.ts`'s pattern.
 */
import { describe, expect, it } from 'vitest';
import { narrate } from '@receipts/engine';
import { deriveNemesisVerdictBeats, type NemesisVerdictBeatInput } from '../src/notifications/nemesis-verdict-beats.js';

const PAIRING_ID = 'pairing-1';
const PROFILE_A = 'profile-a';
const PROFILE_B = 'profile-b';

function baseInput(winner: 'a' | 'b' | 'draw'): NemesisVerdictBeatInput {
  const narrationA =
    winner === 'draw'
      ? narrate({ beat: 'nemesis_verdict_draw', data: { opponentHandle: 'bee', myScore: 2, opponentScore: 2 } })
      : winner === 'a'
        ? narrate({ beat: 'nemesis_verdict_win', data: { opponentHandle: 'bee', myScore: 3, opponentScore: 1 } })
        : narrate({ beat: 'nemesis_verdict_loss', data: { winnerHandle: 'bee', winnerScore: 3, loserScore: 1 } });
  const narrationB =
    winner === 'draw'
      ? narrate({ beat: 'nemesis_verdict_draw', data: { opponentHandle: 'aye', myScore: 2, opponentScore: 2 } })
      : winner === 'b'
        ? narrate({ beat: 'nemesis_verdict_win', data: { opponentHandle: 'aye', myScore: 3, opponentScore: 1 } })
        : narrate({ beat: 'nemesis_verdict_loss', data: { winnerHandle: 'aye', winnerScore: 3, loserScore: 1 } });
  return {
    pairingId: PAIRING_ID,
    winner,
    profileAId: PROFILE_A,
    profileBId: PROFILE_B,
    narrationA,
    narrationB,
  };
}

describe('deriveNemesisVerdictBeats (§13.3)', () => {
  it('gives the winner a nemesis_verdict_win beat and the loser a nemesis_verdict_loss beat', () => {
    const beats = deriveNemesisVerdictBeats(baseInput('a'));
    expect(beats).toHaveLength(2);

    const forA = beats.find((b) => b.profileId === PROFILE_A)!;
    const forB = beats.find((b) => b.profileId === PROFILE_B)!;
    expect(forA.kind).toBe('nemesis_verdict_win');
    expect(forB.kind).toBe('nemesis_verdict_loss');
  });

  it('flips which side wins when winner=b', () => {
    const beats = deriveNemesisVerdictBeats(baseInput('b'));
    const forA = beats.find((b) => b.profileId === PROFILE_A)!;
    const forB = beats.find((b) => b.profileId === PROFILE_B)!;
    expect(forA.kind).toBe('nemesis_verdict_loss');
    expect(forB.kind).toBe('nemesis_verdict_win');
  });

  it('gives both sides nemesis_verdict_draw on a draw', () => {
    const beats = deriveNemesisVerdictBeats(baseInput('draw'));
    expect(beats.map((b) => b.kind)).toEqual(['nemesis_verdict_draw', 'nemesis_verdict_draw']);
  });

  it('dedupe keys follow nemesis_verdict:{pairingId}:{profileId}, one per side', () => {
    const beats = deriveNemesisVerdictBeats(baseInput('a'));
    const forA = beats.find((b) => b.profileId === PROFILE_A)!;
    const forB = beats.find((b) => b.profileId === PROFILE_B)!;
    expect(forA.dedupeKey).toBe(`nemesis_verdict:${PAIRING_ID}:${PROFILE_A}`);
    expect(forB.dedupeKey).toBe(`nemesis_verdict:${PAIRING_ID}:${PROFILE_B}`);
  });

  it('payload carries the rendered line, emphasis, and pairing_id for notify:dispatch re-rendering', () => {
    const beats = deriveNemesisVerdictBeats(baseInput('a'));
    const forA = beats.find((b) => b.profileId === PROFILE_A)!;
    expect(forA.payload).toMatchObject({ line: forA.line, pairing_id: PAIRING_ID });
  });

  it('always returns exactly 2 instructions — one per participant', () => {
    for (const winner of ['a', 'b', 'draw'] as const) {
      expect(deriveNemesisVerdictBeats(baseInput(winner))).toHaveLength(2);
    }
  });
});
