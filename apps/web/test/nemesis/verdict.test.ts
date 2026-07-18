import { describe, expect, it } from 'vitest';
import type { ProfileId } from '@receipts/core';
import { deriveOutcome, opponentOf, sideOutcome } from '../../lib/nemesis/verdict';
import type { PairingPublic } from '../../lib/nemesis/types';

// Branded once here so every downstream use (as an override value or a call argument) is
// already contract-shaped — no per-call-site casting needed.
const A = { profile_id: 'a-1' as ProfileId, handle: 'A', slug: 'a' };
const B = { profile_id: 'b-1' as ProfileId, handle: 'B', slug: 'b' };

function pairing(
  overrides: Partial<PairingPublic> = {},
): Pick<PairingPublic, 'status' | 'winner_profile_id' | 'a' | 'b'> {
  return {
    status: 'completed',
    winner_profile_id: null,
    a: A,
    b: B,
    ...overrides,
  };
}

describe('deriveOutcome', () => {
  it('is "in_progress" while the pairing is active/scheduled', () => {
    expect(deriveOutcome(pairing({ status: 'active' }), A.profile_id)).toBe('in_progress');
    expect(deriveOutcome(pairing({ status: 'scheduled' }), A.profile_id)).toBe('in_progress');
  });

  it('is "cancelled" for a cancelled pairing regardless of viewer', () => {
    expect(deriveOutcome(pairing({ status: 'cancelled' }), A.profile_id)).toBe('cancelled');
    expect(deriveOutcome(pairing({ status: 'cancelled' }), null)).toBe('cancelled');
  });

  it('is "win" for the winning participant', () => {
    const p = pairing({ status: 'completed', winner_profile_id: A.profile_id });
    expect(deriveOutcome(p, A.profile_id)).toBe('win');
  });

  it('is "loss" for the losing participant', () => {
    const p = pairing({ status: 'completed', winner_profile_id: A.profile_id });
    expect(deriveOutcome(p, B.profile_id)).toBe('loss');
  });

  it('is "draw" for either participant when there is no winner', () => {
    const p = pairing({ status: 'completed', winner_profile_id: null });
    expect(deriveOutcome(p, A.profile_id)).toBe('draw');
    expect(deriveOutcome(p, B.profile_id)).toBe('draw');
  });

  it('is "unknown" for a spectator (non-participant, or no viewer) on a completed pairing', () => {
    const decisive = pairing({ status: 'completed', winner_profile_id: A.profile_id });
    expect(deriveOutcome(decisive, null)).toBe('unknown');
    expect(deriveOutcome(decisive, 'someone-else')).toBe('unknown');

    const drawn = pairing({ status: 'completed', winner_profile_id: null });
    expect(deriveOutcome(drawn, null)).toBe('unknown');
  });
});

describe('sideOutcome (objective, viewer-independent — used on the public /vs/[pairingId] page, INV-10)', () => {
  it('is "pending" while the pairing is active/scheduled, for either side', () => {
    expect(sideOutcome(pairing({ status: 'active' }), A.profile_id)).toBe('pending');
    expect(sideOutcome(pairing({ status: 'scheduled' }), B.profile_id)).toBe('pending');
  });

  it('is "cancelled" for either side of a cancelled pairing', () => {
    expect(sideOutcome(pairing({ status: 'cancelled' }), A.profile_id)).toBe('cancelled');
    expect(sideOutcome(pairing({ status: 'cancelled' }), B.profile_id)).toBe('cancelled');
  });

  it('is "win" for the winning side and "loss" for the other, with no viewer involved at all', () => {
    const p = pairing({ status: 'completed', winner_profile_id: A.profile_id });
    expect(sideOutcome(p, A.profile_id)).toBe('win');
    expect(sideOutcome(p, B.profile_id)).toBe('loss');
  });

  it('is "draw" for both sides when there is no winner', () => {
    const p = pairing({ status: 'completed', winner_profile_id: null });
    expect(sideOutcome(p, A.profile_id)).toBe('draw');
    expect(sideOutcome(p, B.profile_id)).toBe('draw');
  });
});

describe('opponentOf', () => {
  it('returns b when the viewer is a', () => {
    expect(opponentOf({ a: A, b: B }, A.profile_id)).toEqual(B);
  });

  it('returns a when the viewer is b', () => {
    expect(opponentOf({ a: A, b: B }, B.profile_id)).toEqual(A);
  });

  it('returns null for a spectator', () => {
    expect(opponentOf({ a: A, b: B }, null)).toBeNull();
    expect(opponentOf({ a: A, b: B }, 'someone-else')).toBeNull();
  });
});
