/**
 * Custom-handle profanity denylist (design doc §6.1.2). `packages/core/src/handles.ts`'s own
 * comment scopes this explicitly to WS2-T1 ("the profanity denylist itself is WS2-T1 scope"),
 * so it's curated here rather than in core — screened the same normalized way as core's
 * `isReservedHandle` (lowercase, separators stripped, leetspeak folded), but never applied to
 * generated animal handles, only to CUSTOM handles at claim/settings time (see
 * `handle-screen.ts`).
 */

/** A reasonably-sized curated list of common slurs / obviously-unacceptable terms. */
const PROFANITY_TERMS = [
  'fuck',
  'shit',
  'bitch',
  'cunt',
  'nigger',
  'nigga',
  'fag',
  'faggot',
  'retard',
  'whore',
  'slut',
  'rape',
  'rapist',
  'kike',
  'spic',
  'chink',
  'tranny',
  'dyke',
  'coon',
  'wetback',
  'gook',
  'pedo',
  'pedophile',
] as const;

/**
 * Normalized screening candidates — mirrors `packages/core/src/handles.ts`'s
 * `screeningCandidates` (not exported from core, so duplicated at this small size rather than
 * widening core's public surface for one internal helper).
 */
function screeningCandidates(handle: string): string[] {
  const base = handle
    .toLowerCase()
    .replace(/[_\-.\s]/g, '')
    .replace(/0/g, 'o')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
    .replace(/7/g, 't')
    .replace(/@/g, 'a')
    .replace(/\$/g, 's');
  return [base.replace(/1/g, 'i'), base.replace(/1/g, 'l')];
}

/** True when a proposed custom handle contains a denylisted term. */
export function isProfaneHandle(handle: string): boolean {
  return screeningCandidates(handle).some((normalized) =>
    PROFANITY_TERMS.some((term) => normalized.includes(term)),
  );
}
