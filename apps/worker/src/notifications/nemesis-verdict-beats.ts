/**
 * Nemesis verdict beat selection (WS5-T3, §13.3): given a concluded pairing's per-side
 * `narrate()` output, derive the `nemesis_verdict_win`/`_loss`/`_draw` outbox beats for both
 * participants. Pure, no DB — mirrors `reveal-beats.ts`'s pattern (derive pure, then
 * `writeBeatsToOutbox`); the caller (`../jobs/nemesis-conclude.ts`) is the only place that
 * touches Postgres, calling this from inside the same transaction that just flipped the
 * pairing `active` → `completed`.
 *
 * Dedupe key: `nemesis_verdict:{pairingId}:{profileId}` — a pairing concludes exactly once
 * (§5.7/§8.8), so one verdict beat per side per pairing is all this ever needs to guard.
 */
import type { NarrationLine } from '@receipts/engine';
import type { BeatInstructionLike } from './write-outbox.js';

export type NemesisVerdictBeatKind = 'nemesis_verdict_win' | 'nemesis_verdict_loss' | 'nemesis_verdict_draw';

export interface NemesisVerdictBeatInput {
  pairingId: string;
  winner: 'a' | 'b' | 'draw';
  profileAId: string;
  profileBId: string;
  /** Already-rendered `narrate()` output for A's side (win/loss/draw variant already chosen by
   * the caller, which knows `winner`). */
  narrationA: NarrationLine;
  /** Same for B's side. */
  narrationB: NarrationLine;
}

export interface NemesisVerdictBeatInstruction extends BeatInstructionLike {
  kind: NemesisVerdictBeatKind;
  /** Rendered `narrate()` line — informational; the outbox row persists `payload`, not this
   * (mirrors `reveal-beats.ts`'s `RevealBeatInstruction`). */
  line: string;
  emphasis?: string;
}

function dedupeKey(pairingId: string, profileId: string): string {
  return `nemesis_verdict:${pairingId}:${profileId}`;
}

function kindFor(winner: 'a' | 'b' | 'draw', side: 'a' | 'b'): NemesisVerdictBeatKind {
  if (winner === 'draw') return 'nemesis_verdict_draw';
  return winner === side ? 'nemesis_verdict_win' : 'nemesis_verdict_loss';
}

function toInstruction(
  profileId: string,
  kind: NemesisVerdictBeatKind,
  pairingId: string,
  narration: NarrationLine,
): NemesisVerdictBeatInstruction {
  return {
    profileId,
    kind,
    line: narration.line,
    emphasis: narration.emphasis,
    // `notify:dispatch` (WS9-T1) re-renders via `narrate()` at send time from this payload, so
    // copy changes never require backfilling stored strings (same contract as reveal-beats.ts).
    payload: { line: narration.line, emphasis: narration.emphasis ?? null, pairing_id: pairingId },
    dedupeKey: dedupeKey(pairingId, profileId),
  };
}

/** Selects the win/loss (or draw/draw) beat pair for one concluded pairing's two sides. Always
 * returns exactly 2 instructions — every pairing conclusion notifies both participants. */
export function deriveNemesisVerdictBeats(input: NemesisVerdictBeatInput): NemesisVerdictBeatInstruction[] {
  return [
    toInstruction(input.profileAId, kindFor(input.winner, 'a'), input.pairingId, input.narrationA),
    toInstruction(input.profileBId, kindFor(input.winner, 'b'), input.pairingId, input.narrationB),
  ];
}
