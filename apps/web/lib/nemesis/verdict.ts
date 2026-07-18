/**
 * Verdict display logic for a completed (or in-progress) nemesis pairing (design doc §19.3
 * WS7-T6 AC: "verdict card win AND loss variants"; §8.8 winner/draw already computed
 * server-side by `nemesis:conclude` — this module only decides how to *render* that result
 * for a given viewer, never recomputes score/edge/tiebreak math, which is WS5-T3 scope).
 */
import type { PairingPublic } from './types';

export type PairingOutcome = 'in_progress' | 'cancelled' | 'win' | 'loss' | 'draw' | 'unknown';

export type SideOutcome = 'pending' | 'cancelled' | 'win' | 'loss' | 'draw';

/**
 * The OBJECTIVE result for one named side (`a` or `b`) of a pairing — who actually won,
 * independent of who's looking. This is what the public matchup card's verdict stamps use
 * (design doc §19.3 WS7-T6 AC: "verdict card win AND loss variants"): `/vs/[pairingId]` is a
 * `none`-auth page whose server render must stay viewer-free (INV-10), so the verdict can
 * never be "did YOU win" there — it has to be "who won," shown identically to every visitor.
 */
export function sideOutcome(
  pairing: Pick<PairingPublic, 'status' | 'winner_profile_id'>,
  sideProfileId: string,
): SideOutcome {
  if (pairing.status === 'cancelled') return 'cancelled';
  if (pairing.status !== 'completed') return 'pending';
  if (pairing.winner_profile_id === null) return 'draw';
  return pairing.winner_profile_id === sideProfileId ? 'win' : 'loss';
}

/**
 * `'unknown'` only when the pairing is `completed` with no `winner_profile_id` AND the
 * viewer isn't a participant — i.e. a spectator looking at someone else's draw, where
 * "win"/"loss" framing doesn't apply to them either. Participants always get `'draw'`.
 *
 * This is the VIEWER-RELATIVE framing ("did *I* win") — useful for first-person copy on a
 * viewer-aware surface (e.g. `/nemesis`'s own narration), but NOT what the public matchup
 * card's stamps should use; see `sideOutcome` above for that.
 */
export function deriveOutcome(
  pairing: Pick<PairingPublic, 'status' | 'winner_profile_id' | 'a' | 'b'>,
  viewerProfileId: string | null,
): PairingOutcome {
  if (pairing.status === 'cancelled') return 'cancelled';
  if (pairing.status !== 'completed') return 'in_progress';

  const viewerIsParticipant =
    viewerProfileId !== null &&
    (viewerProfileId === pairing.a.profile_id || viewerProfileId === pairing.b.profile_id);
  if (!viewerIsParticipant) return 'unknown';

  if (pairing.winner_profile_id === null) return 'draw';
  return pairing.winner_profile_id === viewerProfileId ? 'win' : 'loss';
}

/** The opposing side's `ProfileRef`, from the viewer's point of view (null for spectators). */
export function opponentOf(
  pairing: Pick<PairingPublic, 'a' | 'b'>,
  viewerProfileId: string | null,
): PairingPublic['a'] | PairingPublic['b'] | null {
  if (viewerProfileId === pairing.a.profile_id) return pairing.b;
  if (viewerProfileId === pairing.b.profile_id) return pairing.a;
  return null;
}
