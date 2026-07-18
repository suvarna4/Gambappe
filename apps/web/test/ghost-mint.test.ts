/**
 * Ghost mint rate-limit test (WS2-T1 AC): 429/RATE_LIMITED after the Nth mint from one IP.
 * Uses the in-memory limiter fake (same interface the Redis adapter implements) and fake
 * handle/insert deps — no Postgres/Redis required.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { ApiError, GHOST_MINT_PER_IP_PER_DAY } from '@receipts/core';
import type { ProfileRow } from '@receipts/db';
import { mintGhost, type MintGhostDeps } from '@/lib/ghost-mint';
import { InMemoryGhostMintLimiter } from '@/lib/ghost-mint-limiter';

beforeAll(() => {
  process.env.GHOST_COOKIE_SECRET = 'unit-test-ghost-cookie-secret';
});

function fakeDeps(): MintGhostDeps {
  const handles = new Set<string>();
  return {
    handleExists: async (h) => handles.has(h),
    insertProfile: async (row) => {
      handles.add(row.handle);
      return { ...row, createdAt: new Date(), updatedAt: new Date() } as ProfileRow;
    },
  };
}

describe('mintGhost (§6.1.1)', () => {
  it('mints a profile and returns a cookie value of the form <id>.<secret>', async () => {
    const result = await mintGhost(fakeDeps(), '1.2.3.4', new InMemoryGhostMintLimiter(), new Date('2026-07-19T09:00:00Z'));
    expect(result.profile.kind).toBe('ghost');
    expect(result.profile.status).toBe('active');
    expect(result.cookieValue.split('.')).toHaveLength(2);
    expect(result.cookieValue.startsWith(result.profile.id)).toBe(true);
  });

  it(`allows exactly ${GHOST_MINT_PER_IP_PER_DAY} mints per IP per day, then RATE_LIMITED`, async () => {
    const limiter = new InMemoryGhostMintLimiter();
    const at = new Date('2026-07-19T09:00:00Z');
    for (let i = 0; i < GHOST_MINT_PER_IP_PER_DAY; i++) {
      await expect(mintGhost(fakeDeps(), '9.9.9.9', limiter, at)).resolves.toBeDefined();
    }
    await expect(mintGhost(fakeDeps(), '9.9.9.9', limiter, at)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
  });

  it('is scoped per IP — a different IP is unaffected', async () => {
    const limiter = new InMemoryGhostMintLimiter();
    const at = new Date('2026-07-19T09:00:00Z');
    for (let i = 0; i < GHOST_MINT_PER_IP_PER_DAY; i++) {
      await mintGhost(fakeDeps(), '1.1.1.1', limiter, at);
    }
    await expect(mintGhost(fakeDeps(), '2.2.2.2', limiter, at)).resolves.toBeDefined();
  });

  it('is scoped per day — a new day resets the counter', async () => {
    const limiter = new InMemoryGhostMintLimiter();
    for (let i = 0; i < GHOST_MINT_PER_IP_PER_DAY; i++) {
      await mintGhost(fakeDeps(), '3.3.3.3', limiter, new Date('2026-07-19T09:00:00Z'));
    }
    await expect(
      mintGhost(fakeDeps(), '3.3.3.3', limiter, new Date('2026-07-20T00:00:01Z')),
    ).resolves.toBeDefined();
  });

  it('the rejection is a real ApiError with RATE_LIMITED (429)', async () => {
    const limiter = new InMemoryGhostMintLimiter();
    const at = new Date('2026-07-19T09:00:00Z');
    for (let i = 0; i < GHOST_MINT_PER_IP_PER_DAY; i++) {
      await mintGhost(fakeDeps(), '4.4.4.4', limiter, at);
    }
    try {
      await mintGhost(fakeDeps(), '4.4.4.4', limiter, at);
      expect.unreachable();
    } catch (e) {
      expect(ApiError.is(e)).toBe(true);
      expect((e as ApiError).status).toBe(429);
    }
  });
});
