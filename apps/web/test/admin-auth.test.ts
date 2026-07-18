import { describe, expect, it } from 'vitest';
import {
  constantTimeEqual,
  extractBearerToken,
  isAdminRequestAuthorized,
  isIpAllowed,
  parseAllowlist,
} from '../lib/admin-auth';

describe('constantTimeEqual', () => {
  it('is true for identical strings', () => {
    expect(constantTimeEqual('secret-token', 'secret-token')).toBe(true);
  });

  it('is false for different strings of the same length', () => {
    expect(constantTimeEqual('secret-token', 'secret-tokeX')).toBe(false);
  });

  it('is false for different-length strings', () => {
    expect(constantTimeEqual('short', 'much-longer-string')).toBe(false);
  });
});

describe('parseAllowlist', () => {
  it('splits on commas and trims whitespace', () => {
    expect(parseAllowlist('1.2.3.4, 5.6.7.8 ,9.9.9.9')).toEqual(['1.2.3.4', '5.6.7.8', '9.9.9.9']);
  });

  it('returns empty for unset/empty', () => {
    expect(parseAllowlist(undefined)).toEqual([]);
    expect(parseAllowlist('')).toEqual([]);
  });
});

describe('isIpAllowed', () => {
  it('allows an IP on the list', () => {
    expect(isIpAllowed('1.2.3.4', ['1.2.3.4', '5.6.7.8'])).toBe(true);
  });

  it('rejects an IP not on the list', () => {
    expect(isIpAllowed('9.9.9.9', ['1.2.3.4'])).toBe(false);
  });

  it('fails closed on an empty allowlist (unset config allows nobody)', () => {
    expect(isIpAllowed('1.2.3.4', [])).toBe(false);
  });

  it('fails closed when there is no IP to check', () => {
    expect(isIpAllowed(null, ['1.2.3.4'])).toBe(false);
  });
});

describe('extractBearerToken', () => {
  it('reads a Bearer token', () => {
    const headers = new Headers({ authorization: 'Bearer abc123' });
    expect(extractBearerToken(headers)).toBe('abc123');
  });

  it('returns null for a non-Bearer scheme', () => {
    const headers = new Headers({ authorization: 'Basic abc123' });
    expect(extractBearerToken(headers)).toBeNull();
  });

  it('returns null when absent', () => {
    expect(extractBearerToken(new Headers())).toBeNull();
  });
});

describe('isAdminRequestAuthorized', () => {
  const env = { ADMIN_STOPGAP_TOKEN: 'the-real-token', ADMIN_STOPGAP_IP_ALLOWLIST: '1.2.3.4' };

  it('authorizes the right token from an allowed IP', () => {
    const headers = new Headers({
      authorization: 'Bearer the-real-token',
      'x-forwarded-for': '1.2.3.4',
    });
    expect(isAdminRequestAuthorized(headers, env)).toBe(true);
  });

  it('rejects the right token from a disallowed IP', () => {
    const headers = new Headers({
      authorization: 'Bearer the-real-token',
      'x-forwarded-for': '9.9.9.9',
    });
    expect(isAdminRequestAuthorized(headers, env)).toBe(false);
  });

  it('rejects the wrong token from an allowed IP', () => {
    const headers = new Headers({
      authorization: 'Bearer wrong-token',
      'x-forwarded-for': '1.2.3.4',
    });
    expect(isAdminRequestAuthorized(headers, env)).toBe(false);
  });

  it('rejects when no token is configured at all (fails closed)', () => {
    const headers = new Headers({
      authorization: 'Bearer the-real-token',
      'x-forwarded-for': '1.2.3.4',
    });
    expect(isAdminRequestAuthorized(headers, { ADMIN_STOPGAP_IP_ALLOWLIST: '1.2.3.4' })).toBe(
      false,
    );
  });

  it('rejects a request with no authorization header', () => {
    const headers = new Headers({ 'x-forwarded-for': '1.2.3.4' });
    expect(isAdminRequestAuthorized(headers, env)).toBe(false);
  });
});
