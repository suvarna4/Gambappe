/**
 * Pure eligibility checks for the pick/undo UI (§6.2, DD-11/INV-9). Kept framework-free so
 * they're unit-testable without mounting `ViewerStrip`.
 */
import type { CachedPick } from './pick-storage';

/** DD-11: 18+ attestation is required at first pick — this decides whether the two-tap
 * age-gate confirm needs to show before the side tap is actually submitted. */
export function needsAgeGate(ageAttested: boolean): boolean {
  return !ageAttested;
}

/** §6.2 undo: caller must own the pick (assumed true — this cache is per-device) AND be
 * within both the 60s undo window AND before lock (both are re-checked server-side against
 * the DB clock regardless — this only decides whether to SHOW the undo control). */
export function canUndo(pick: CachedPick, nowMs: number, lockAtIso: string): boolean {
  return nowMs < new Date(pick.undoUntilIso).getTime() && nowMs < new Date(lockAtIso).getTime();
}

/** Pick buttons are only meaningful while the question is actually open (§10.3 table). */
export function canPick(questionStatus: string): boolean {
  return questionStatus === 'open';
}
