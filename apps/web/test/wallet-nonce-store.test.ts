/**
 * WS12-T1 AC: "replayed nonce → rejected". `consume` is single-use — the second call for the
 * same nonce (even before any TTL expiry) must return null.
 */
import { describe, expect, it, vi } from 'vitest';
import { InMemoryWalletNonceStore } from '@/lib/wallet-nonce-store';

describe('InMemoryWalletNonceStore', () => {
  it('save then consume returns the bound profileId', async () => {
    const store = new InMemoryWalletNonceStore();
    await store.save('nonce-1', 'profile-1', 600);
    await expect(store.consume('nonce-1')).resolves.toBe('profile-1');
  });

  it('a replayed nonce is rejected: the second consume returns null', async () => {
    const store = new InMemoryWalletNonceStore();
    await store.save('nonce-1', 'profile-1', 600);
    await store.consume('nonce-1');
    await expect(store.consume('nonce-1')).resolves.toBeNull();
  });

  it('an unknown nonce returns null', async () => {
    const store = new InMemoryWalletNonceStore();
    await expect(store.consume('never-saved')).resolves.toBeNull();
  });

  it('an expired nonce (past its TTL) returns null and is consumed (single-use) regardless', async () => {
    vi.useFakeTimers();
    try {
      const store = new InMemoryWalletNonceStore();
      await store.save('nonce-1', 'profile-1', 1); // 1 second TTL
      vi.advanceTimersByTime(2_000);
      await expect(store.consume('nonce-1')).resolves.toBeNull();
      // Also gone on a second attempt — not left dangling for a later legitimate use.
      await expect(store.consume('nonce-1')).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
