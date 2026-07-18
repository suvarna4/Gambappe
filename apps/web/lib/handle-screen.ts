/**
 * Custom-handle screening (design doc §6.1.2): format + reserved-terms (core) + profanity
 * (WS2-T1, `profanity.ts`). Used by claim (fresh claimed profile handles are generated, not
 * screened here) and by `PATCH /me/handle` (WS2-T4).
 */
import { HANDLE_REGEX, isReservedHandle } from '@receipts/core';
import { isProfaneHandle } from './profanity';

export type HandleScreenResult =
  | { ok: true }
  | { ok: false; reason: 'format' | 'reserved' | 'profane' };

export function screenCustomHandle(handle: string): HandleScreenResult {
  if (!HANDLE_REGEX.test(handle)) return { ok: false, reason: 'format' };
  if (isReservedHandle(handle)) return { ok: false, reason: 'reserved' };
  if (isProfaneHandle(handle)) return { ok: false, reason: 'profane' };
  return { ok: true };
}
