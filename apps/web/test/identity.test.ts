/**
 * Auth-matrix unit test (WS2-T1 AC): anonymous/ghost/claimed resolution given various
 * cookie/session states, plus "invalid cookie → cleared, not errored". Uses fake lookups —
 * no Postgres required (`resolveIdentity` takes plain functions, not a `Db`).
 */
import { describe, expect, it } from 'vitest';
import type { ProfileRow } from '@receipts/db';
import { resolveIdentity, type IdentityLookups } from '@/lib/identity';
import { buildGhostCookieValue, generateGhostSecret, hashGhostSecret } from '@/lib/ghost-cookie';

function ghostProfile(overrides: Partial<ProfileRow> = {}): ProfileRow {
  const secret = generateGhostSecret();
  return {
    id: '018e6b1a-0000-7000-8000-000000000001',
    kind: 'ghost',
    status: 'active',
    handle: 'Fox #1234',
    slug: 'fox-1234',
    matchmakingPriority: false,
    handleIsGenerated: true,
    handleChangedAt: null,
    userId: null,
    ghostSecretHash: hashGhostSecret(secret),
    mergedIntoProfileId: null,
    claimedAt: null,
    lastSeenAt: new Date(),
    timezone: null,
    ageAttestedAt: null,
    botScore: 0,
    currentStreak: 0,
    bestStreak: 0,
    lastCountedDate: null,
    freezeBank: 0,
    currentWinStreak: 0,
    bestWinStreak: 0,
    settings: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as ProfileRow;
}

function claimedProfile(overrides: Partial<ProfileRow> = {}): ProfileRow {
  return { ...ghostProfile(), kind: 'claimed', userId: 'user-1', ghostSecretHash: null, ...overrides };
}

function lookupsFor(profiles: ProfileRow[]): IdentityLookups {
  return {
    getProfileByUserId: async (userId) => profiles.find((p) => p.userId === userId) ?? null,
    getProfileById: async (id) => profiles.find((p) => p.id === id) ?? null,
  };
}

process.env.GHOST_COOKIE_SECRET = 'test-ghost-cookie-secret';

describe('resolveIdentity (§6.1.1 auth resolution order)', () => {
  it('no session, no cookie → anonymous, nothing to clear', async () => {
    const result = await resolveIdentity(null, null, lookupsFor([]));
    expect(result.identity).toEqual({ kind: 'anonymous' });
    expect(result.clearGhostCookie).toBe(false);
  });

  it('valid session with a claimed profile → claimed, cookie untouched', async () => {
    const profile = claimedProfile();
    const result = await resolveIdentity({ userId: 'user-1' }, null, lookupsFor([profile]));
    expect(result.identity).toEqual({ kind: 'claimed', profile, userId: 'user-1' });
    expect(result.clearGhostCookie).toBe(false);
  });

  it('valid session, no profile yet → falls through (anonymous here; /claim handles cases A-D)', async () => {
    const result = await resolveIdentity({ userId: 'user-1' }, null, lookupsFor([]));
    expect(result.identity).toEqual({ kind: 'anonymous' });
  });

  it('no session, valid ghost cookie → ghost', async () => {
    const secret = generateGhostSecret();
    const profile = ghostProfile({ ghostSecretHash: hashGhostSecret(secret) });
    const cookieValue = buildGhostCookieValue(profile.id, secret);
    const result = await resolveIdentity(null, cookieValue, lookupsFor([profile]));
    expect(result.identity).toEqual({ kind: 'ghost', profile });
    expect(result.clearGhostCookie).toBe(false);
  });

  it('session takes priority over a ghost cookie when a claimed profile exists', async () => {
    const claimed = claimedProfile({ userId: 'user-1', id: 'claimed-id' });
    const secret = generateGhostSecret();
    const ghost = ghostProfile({ ghostSecretHash: hashGhostSecret(secret), id: 'ghost-id' });
    const cookieValue = buildGhostCookieValue(ghost.id, secret);
    const result = await resolveIdentity({ userId: 'user-1' }, cookieValue, lookupsFor([claimed, ghost]));
    expect(result.identity.kind).toBe('claimed');
  });

  it('malformed cookie value → anonymous AND cleared (never errors)', async () => {
    const result = await resolveIdentity(null, 'not-a-valid-cookie-format', lookupsFor([]));
    expect(result.identity).toEqual({ kind: 'anonymous' });
    expect(result.clearGhostCookie).toBe(true);
  });

  it('cookie references a nonexistent profile id → anonymous AND cleared', async () => {
    const cookieValue = buildGhostCookieValue('018e6b1a-0000-7000-8000-0000000000ff', generateGhostSecret());
    const result = await resolveIdentity(null, cookieValue, lookupsFor([]));
    expect(result.identity).toEqual({ kind: 'anonymous' });
    expect(result.clearGhostCookie).toBe(true);
  });

  it('cookie secret does not match the stored hash → anonymous AND cleared', async () => {
    const profile = ghostProfile();
    const wrongSecret = generateGhostSecret();
    const cookieValue = buildGhostCookieValue(profile.id, wrongSecret);
    const result = await resolveIdentity(null, cookieValue, lookupsFor([profile]));
    expect(result.identity).toEqual({ kind: 'anonymous' });
    expect(result.clearGhostCookie).toBe(true);
  });

  it('cookie for a claimed (non-ghost) profile id → anonymous AND cleared', async () => {
    const secret = generateGhostSecret();
    const profile = claimedProfile({ ghostSecretHash: hashGhostSecret(secret) });
    const cookieValue = buildGhostCookieValue(profile.id, secret);
    const result = await resolveIdentity(null, cookieValue, lookupsFor([profile]));
    expect(result.identity).toEqual({ kind: 'anonymous' });
    expect(result.clearGhostCookie).toBe(true);
  });

  it('cookie for a merged/deleted ghost profile → anonymous AND cleared', async () => {
    const secret = generateGhostSecret();
    const profile = ghostProfile({ status: 'deleted', ghostSecretHash: hashGhostSecret(secret) });
    const cookieValue = buildGhostCookieValue(profile.id, secret);
    const result = await resolveIdentity(null, cookieValue, lookupsFor([profile]));
    expect(result.identity).toEqual({ kind: 'anonymous' });
    expect(result.clearGhostCookie).toBe(true);
  });
});
