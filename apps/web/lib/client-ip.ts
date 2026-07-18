/**
 * Best-effort client IP extraction (Vercel/most proxies set `x-forwarded-for`, leftmost = the
 * original client). No IP is ever persisted raw (INV — see §5.6 `analytics_events` IP hashing);
 * this is used only as a rate-limit KEY (§6.1.1 ghost-mint-per-IP), never stored.
 */
export function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const first = forwardedFor.split(',')[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get('x-real-ip');
  if (realIp) return realIp;
  // No proxy header present (e.g. local dev) — fall back to a shared bucket rather than
  // throwing; rate limiting degrades to "shared across unknown-origin traffic," never crashes.
  return 'unknown';
}
