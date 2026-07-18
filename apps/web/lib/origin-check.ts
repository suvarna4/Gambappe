/**
 * Same-origin / CSRF middleware (design doc §11.2, §9.2): our mutations rely on SameSite=Lax
 * + an explicit Origin allow-list check (Auth.js has its own CSRF handling for its own routes
 * only). No CORS allowances on `/api/v1/*` mutations. Reused by every mutation route handler
 * across all workstreams — kept as a small composable helper.
 */
import { ApiError } from '@receipts/core';

/**
 * Throws `ApiError('CSRF_REJECTED')` unless `request` can be shown to be same-origin with
 * `NEXT_PUBLIC_APP_URL`. GET/HEAD never mutate (§11.2) and are exempt. Modern browsers send
 * `Sec-Fetch-Site` on essentially every request; we prefer it and fall back to `Origin`. If
 * NEITHER header is present we fail closed (a real same-origin browser POST always sends at
 * least one) — this is deliberately strict, matching "no CORS allowances" (§11.2).
 */
export function assertSameOrigin(request: Request): void {
  if (request.method === 'GET' || request.method === 'HEAD') return;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) throw new Error('NEXT_PUBLIC_APP_URL is not set (see .env.example)');
  const expectedOrigin = new URL(appUrl).origin;

  const secFetchSite = request.headers.get('sec-fetch-site');
  if (secFetchSite !== null) {
    if (secFetchSite === 'same-origin' || secFetchSite === 'none') return;
    throw new ApiError('CSRF_REJECTED', 'cross-origin request rejected');
  }

  const origin = request.headers.get('origin');
  if (origin !== null) {
    if (origin === expectedOrigin) return;
    throw new ApiError('CSRF_REJECTED', 'cross-origin request rejected');
  }

  throw new ApiError('CSRF_REJECTED', 'missing Origin/Sec-Fetch-Site header on a mutation');
}
