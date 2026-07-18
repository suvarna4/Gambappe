import { describe, expect, it } from 'vitest';
import { HANDLE_CHANGE_COOLDOWN_DAYS } from '@receipts/core';
import { checkHandleCooldown } from '@/lib/handle-cooldown';

describe('checkHandleCooldown (§6.1.2)', () => {
  it('allows a first-ever change (handleChangedAt null)', () => {
    expect(checkHandleCooldown(null, new Date('2026-07-19T00:00:00Z'))).toEqual({ allowed: true });
  });

  it('rejects a second change within the cooldown window', () => {
    const changedAt = new Date('2026-07-01T00:00:00Z');
    const at = new Date(changedAt.getTime() + (HANDLE_CHANGE_COOLDOWN_DAYS - 1) * 24 * 3600_000);
    const result = checkHandleCooldown(changedAt, at);
    expect(result.allowed).toBe(false);
    expect(result.nextAllowedAt).toEqual(
      new Date(changedAt.getTime() + HANDLE_CHANGE_COOLDOWN_DAYS * 24 * 3600_000),
    );
  });

  it('allows a change exactly at the cooldown boundary', () => {
    const changedAt = new Date('2026-07-01T00:00:00Z');
    const at = new Date(changedAt.getTime() + HANDLE_CHANGE_COOLDOWN_DAYS * 24 * 3600_000);
    expect(checkHandleCooldown(changedAt, at).allowed).toBe(true);
  });

  it('allows a change well after the cooldown', () => {
    const changedAt = new Date('2026-01-01T00:00:00Z');
    const at = new Date('2026-07-19T00:00:00Z');
    expect(checkHandleCooldown(changedAt, at).allowed).toBe(true);
  });
});
