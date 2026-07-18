/**
 * Auth.js session cookie configuration (design doc §11.1): `__Secure-` prefixed, HttpOnly,
 * SameSite=Lax, 30-day rolling. Pulled into a small pure function so the cookie config itself
 * is unit-testable without booting Auth.js/a real HTTP server (§17.2 tooling-limits guidance).
 *
 * The `__Secure-` prefix requires the `Secure` flag (browsers reject the cookie otherwise),
 * which in turn requires HTTPS — so it's applied only when `secure` is true (production /
 * anywhere serving over TLS). Local dev over plain http gets the unprefixed name so sign-in
 * still works; this mirrors Auth.js's own `useSecureCookies` convention.
 */

/** 30-day rolling session (§11.1). */
export const SESSION_MAX_AGE_S = 30 * 24 * 60 * 60;

export interface SessionCookieConfig {
  name: string;
  options: {
    httpOnly: true;
    sameSite: 'lax';
    path: '/';
    secure: boolean;
  };
}

export function sessionCookieConfig(secure: boolean): SessionCookieConfig {
  return {
    name: secure ? '__Secure-authjs.session-token' : 'authjs.session-token',
    options: { httpOnly: true, sameSite: 'lax', path: '/', secure },
  };
}
