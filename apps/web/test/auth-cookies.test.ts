/**
 * Session cookie flags test (WS2-T2 AC): unit-test the config object's cookie settings
 * directly (§11.1: `__Secure-` prefixed, HttpOnly, SameSite=Lax).
 */
import { describe, expect, it } from 'vitest';
import { sessionCookieConfig, SESSION_MAX_AGE_S } from '@/lib/auth-cookies';

describe('sessionCookieConfig (§11.1)', () => {
  it('is 30-day rolling', () => {
    expect(SESSION_MAX_AGE_S).toBe(30 * 24 * 60 * 60);
  });

  it('uses the __Secure- prefix + Secure flag when secure', () => {
    const cfg = sessionCookieConfig(true);
    expect(cfg.name).toBe('__Secure-authjs.session-token');
    expect(cfg.options).toEqual({ httpOnly: true, sameSite: 'lax', path: '/', secure: true });
  });

  it('drops the __Secure- prefix (which requires Secure) over plain http', () => {
    const cfg = sessionCookieConfig(false);
    expect(cfg.name).toBe('authjs.session-token');
    expect(cfg.options.secure).toBe(false);
  });

  it('is always HttpOnly + SameSite=Lax regardless of secure', () => {
    for (const secure of [true, false]) {
      const cfg = sessionCookieConfig(secure);
      expect(cfg.options.httpOnly).toBe(true);
      expect(cfg.options.sameSite).toBe('lax');
      expect(cfg.options.path).toBe('/');
    }
  });
});
