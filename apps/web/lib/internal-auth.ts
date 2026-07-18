/**
 * Bearer auth for worker→web internal calls (design doc §9.2, §2.4): `INTERNAL_API_SECRET`,
 * constant-time compare. Reuses the same primitives as the P0 admin stopgap
 * (`extractBearerToken`, `constantTimeEqual` from `./admin-auth`, WS10-T1) — same shape of
 * problem, different secret and no IP allowlist (§2.4: "IP-unrestricted but unguessable +
 * idempotent").
 */
import { constantTimeEqual, extractBearerToken } from './admin-auth';

export function isInternalRequestAuthorized(headers: Headers): boolean {
  const expected = process.env.INTERNAL_API_SECRET;
  if (!expected) return false; // fail closed — unset secret means nobody is internal (§14.1 posture)
  const provided = extractBearerToken(headers);
  if (!provided) return false;
  return constantTimeEqual(provided, expected);
}
