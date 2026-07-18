/**
 * P0 admin stopgap auth (design doc §19.5, WS10-T1): a strong random bearer token
 * (`ADMIN_STOPGAP_TOKEN`, 32+ random bytes) PLUS an IP allowlist — deliberately not "basic
 * auth with a guessable password." Replaced by Auth.js role auth (`users.role='admin'`) in
 * P1, on the same routes (§15.1). Non-admin/no-token requests 404 (§19.5 AC) rather than
 * 401/403 — the existence of `/admin` isn't acknowledged to unauthorized callers.
 */
import { extractClientIp } from './http';

/** Constant-time string compare — avoids leaking the token via response-time comparison. */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export function parseAllowlist(raw: string | undefined | null): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isIpAllowed(ip: string | null, allowlist: string[]): boolean {
  // Fail closed: an empty allowlist (unset env var) allows nobody, same posture as
  // Redis-down rate limiting (§14.1) — a missing config must never mean "allow all".
  if (!ip || allowlist.length === 0) return false;
  return allowlist.includes(ip);
}

export function extractBearerToken(headers: Headers): string | null {
  const auth = headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  return auth.slice('Bearer '.length).trim() || null;
}

export interface AdminAuthEnv {
  ADMIN_STOPGAP_TOKEN?: string;
  ADMIN_STOPGAP_IP_ALLOWLIST?: string;
}

/**
 * True only when both the bearer token matches AND the caller's IP is on the allowlist.
 * Fails closed on any missing configuration (no token configured → nobody is admin).
 *
 * `queryToken` (WS10-T2): the P0 stopgap has no login form and browsers don't attach
 * custom headers on plain navigation, so a curator can't reach an `/admin` *page* with the
 * Authorization header alone — only API tooling (curl, fetch with manual headers) can. A
 * `?token=` fallback lets a human open an emailed/pasted admin link directly. This is a
 * deliberate P0-only convenience: the token then appears in browser history and, if
 * request URLs are ever logged, in logs — acceptable only alongside the IP allowlist and
 * only until P1's Auth.js session replaces this whole scheme (§19.5).
 */
export function isAdminRequestAuthorized(
  headers: Headers,
  env: AdminAuthEnv,
  queryToken?: string | null,
): boolean {
  const expectedToken = env.ADMIN_STOPGAP_TOKEN;
  if (!expectedToken) return false;

  const providedToken = extractBearerToken(headers) ?? queryToken ?? null;
  if (!providedToken || !constantTimeEqual(providedToken, expectedToken)) return false;

  const allowlist = parseAllowlist(env.ADMIN_STOPGAP_IP_ALLOWLIST);
  return isIpAllowed(extractClientIp(headers), allowlist);
}
