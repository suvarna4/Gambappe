import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  buildGhostCookieValue,
  generateGhostSecret,
  hashGhostSecret,
  parseGhostCookieValue,
  verifyGhostSecret,
} from '@/lib/ghost-cookie';

beforeAll(() => {
  process.env.GHOST_COOKIE_SECRET = 'unit-test-ghost-cookie-secret';
});

describe('ghost-cookie (§6.1.1)', () => {
  it('hashes with HMAC-SHA256 keyed by GHOST_COOKIE_SECRET, not plain sha256', () => {
    const secret = generateGhostSecret();
    const hash = hashGhostSecret(secret);
    // A plain sha256 of the secret would differ from the HMAC (keyed) digest.
    const plainSha256 = createHash('sha256').update(secret).digest('hex');
    expect(hash).not.toBe(plainSha256);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('round-trips: verifyGhostSecret accepts the correct secret against its own hash', () => {
    const secret = generateGhostSecret();
    const hash = hashGhostSecret(secret);
    expect(verifyGhostSecret(secret, hash)).toBe(true);
  });

  it('rejects a wrong secret', () => {
    const hash = hashGhostSecret(generateGhostSecret());
    expect(verifyGhostSecret(generateGhostSecret(), hash)).toBe(false);
  });

  it('parses a well-formed cookie value', () => {
    const secret = generateGhostSecret();
    const id = '018e6b1a-0000-7000-8000-000000000001';
    const value = buildGhostCookieValue(id, secret);
    expect(parseGhostCookieValue(value)).toEqual({ profileId: id, secret });
  });

  it('returns null (never throws) for malformed values', () => {
    expect(parseGhostCookieValue(null)).toBeNull();
    expect(parseGhostCookieValue(undefined)).toBeNull();
    expect(parseGhostCookieValue('')).toBeNull();
    expect(parseGhostCookieValue('no-dot-here')).toBeNull();
    expect(parseGhostCookieValue('not-a-uuid.secret')).toBeNull();
    expect(parseGhostCookieValue('018e6b1a-0000-7000-8000-000000000001.')).toBeNull();
  });
});
