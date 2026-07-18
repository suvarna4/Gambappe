/**
 * Postgres error-code helpers, for callers that pre-check a uniqueness constraint (to give a
 * clean error) but still need to catch the raw DB error as defense-in-depth against a TOCTOU
 * race the pre-check can't fully close.
 */
export function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code: unknown }).code === '23505';
}
