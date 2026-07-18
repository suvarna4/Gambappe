import { describe, expect, it } from 'vitest';
import {
  dailySaltDateKey,
  extractClientIp,
  extractUserAgent,
  hashWithSalt,
} from '../lib/analytics';

describe('dailySaltDateKey', () => {
  it('formats as YYYY-MM-DD (UTC)', () => {
    expect(dailySaltDateKey(new Date('2026-07-18T23:59:59Z'))).toBe('2026-07-18');
    expect(dailySaltDateKey(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01-01');
  });
});

describe('hashWithSalt', () => {
  it('is deterministic for the same value+salt', () => {
    expect(hashWithSalt('1.2.3.4', 'salt-a')).toBe(hashWithSalt('1.2.3.4', 'salt-a'));
  });

  it('differs across salts (rotation invalidates old hashes)', () => {
    expect(hashWithSalt('1.2.3.4', 'salt-a')).not.toBe(hashWithSalt('1.2.3.4', 'salt-b'));
  });

  it('differs across values (no collisions for adjacent IPs)', () => {
    expect(hashWithSalt('1.2.3.4', 'salt-a')).not.toBe(hashWithSalt('1.2.3.5', 'salt-a'));
  });

  it('never contains the raw value (sanity — it is a hex digest)', () => {
    const hash = hashWithSalt('1.2.3.4', 'salt-a');
    expect(hash).not.toContain('1.2.3.4');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('extractClientIp', () => {
  it('takes the first hop of X-Forwarded-For', () => {
    const headers = new Headers({ 'x-forwarded-for': '9.9.9.9, 10.0.0.1' });
    expect(extractClientIp(headers)).toBe('9.9.9.9');
  });

  it('falls back to X-Real-IP', () => {
    const headers = new Headers({ 'x-real-ip': '8.8.8.8' });
    expect(extractClientIp(headers)).toBe('8.8.8.8');
  });

  it('returns null when neither header is present', () => {
    expect(extractClientIp(new Headers())).toBeNull();
  });
});

describe('extractUserAgent', () => {
  it('reads the User-Agent header', () => {
    const headers = new Headers({ 'user-agent': 'test-agent/1.0' });
    expect(extractUserAgent(headers)).toBe('test-agent/1.0');
  });

  it('returns null when absent', () => {
    expect(extractUserAgent(new Headers())).toBeNull();
  });
});
