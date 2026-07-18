/**
 * Zero-dependency request-header helpers. Deliberately has no imports (no `node:crypto`,
 * no `ioredis`) so it's safe to import from Edge-runtime code — namely `middleware.ts` via
 * `admin-auth.ts` (§19.5, WS10-T1). `analytics.ts` (Node runtime, WS13-T1) also uses these.
 */

/**
 * First entry of a (possibly multi-hop) X-Forwarded-For, else X-Real-IP, else null.
 *
 * TRUST BOUNDARY: this header is only as trustworthy as whatever sits in front of this
 * process. §3/§18 host `apps/web` on Vercel, whose edge network sets `x-forwarded-for`
 * authoritatively to the real client IP before invoking the function — that's the
 * assumption both the admin IP allowlist (`admin-auth.ts`, WS10-T1) and analytics IP
 * hashing (`analytics.ts`, WS13-T1) rely on. Running this app directly exposed with no
 * trusted edge/proxy in front (confirmed locally: a bare `next start` passes a
 * client-supplied `x-forwarded-for` straight through unmodified) lets a caller fully spoof
 * this value — never rely on it for access control outside a Vercel-equivalent deployment.
 */
export function extractClientIp(headers: Headers): string | null {
  const forwardedFor = headers.get('x-forwarded-for');
  if (forwardedFor) {
    const first = forwardedFor.split(',')[0]?.trim();
    if (first) return first;
  }
  const realIp = headers.get('x-real-ip');
  return realIp?.trim() || null;
}

export function extractUserAgent(headers: Headers): string | null {
  return headers.get('user-agent')?.trim() || null;
}
