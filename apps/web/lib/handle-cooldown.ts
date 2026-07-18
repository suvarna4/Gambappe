/**
 * Handle-change cooldown check (design doc §6.1.2): `HANDLE_CHANGE_COOLDOWN_DAYS` (30) between
 * custom-handle changes. Pure so it's unit-testable without a DB; `handleChangedAt` is
 * `profiles.handle_changed_at` (WS2-T4's additive column — null for a never-changed handle).
 */
import { HANDLE_CHANGE_COOLDOWN_DAYS } from '@receipts/core';

const COOLDOWN_MS = HANDLE_CHANGE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

export interface HandleCooldownCheck {
  allowed: boolean;
  /** Only set when `allowed` is false. */
  nextAllowedAt?: Date;
}

export function checkHandleCooldown(handleChangedAt: Date | null, at: Date): HandleCooldownCheck {
  if (handleChangedAt === null) return { allowed: true };
  const nextAllowedAt = new Date(handleChangedAt.getTime() + COOLDOWN_MS);
  if (at.getTime() >= nextAllowedAt.getTime()) return { allowed: true };
  return { allowed: false, nextAllowedAt };
}
