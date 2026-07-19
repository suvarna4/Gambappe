/**
 * Best-effort worker→web ISR revalidation (§2.3 step 3, §6.7, §9.2): POST
 * `/api/v1/internal/revalidate` (bearer `INTERNAL_API_SECRET`) after a question state
 * transition commits, so the spectator/question pages flip immediately instead of waiting out
 * the ~30s ISR timer (`ISR_REVALIDATE_QUESTION_S`). Closes the stale SPEC-GAP(WS3-T1)/(WS3-T4)
 * in `question-lock.ts`/`reveal-fire.ts` — the endpoint (WS8-T3) has since merged, fully
 * hardened (allowlist, path cap, global rate limit).
 *
 * Strictly best-effort for callers: the transition is already COMMITTED when this runs, and the
 * ISR timer is the designed fallback (§10.1) — so this function NEVER throws. Unset env
 * (dev/test workers without a web instance), network failure, non-2xx, and timeout all
 * log-and-return; a worker job must not fail (and get redelivered) over a cache nudge.
 */
import { logger } from '../logger.js';

const REVALIDATE_TIMEOUT_MS = 3_000;

/** The pages a question state transition invalidates: its own `/q/*` page + home (`/`). */
export function questionRevalidationPaths(slug: string | null): string[] {
  return slug ? [`/q/${slug}`, '/'] : ['/'];
}

export async function requestRevalidation(paths: string[]): Promise<void> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  const secret = process.env.INTERNAL_API_SECRET;
  if (!appUrl || !secret) {
    // Normal in dev/test (no web instance / no shared secret) — the ISR timer still applies.
    logger.debug({ paths }, 'revalidate skipped — NEXT_PUBLIC_APP_URL or INTERNAL_API_SECRET not set');
    return;
  }

  try {
    const res = await fetch(`${appUrl}/api/v1/internal/revalidate`, {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
      body: JSON.stringify({ paths }),
      signal: AbortSignal.timeout(REVALIDATE_TIMEOUT_MS),
    });
    if (!res.ok) {
      logger.warn({ paths, status: res.status }, 'revalidate call failed (non-2xx) — ISR timer is the fallback');
      return;
    }
    // The endpoint 200s even when some paths are allowlist-rejected, itemizing them — surface
    // that loudly since it means this caller and the web allowlist have drifted (§9.2).
    const body = (await res.json()) as { data?: { rejected?: string[] } };
    const rejected = body.data?.rejected ?? [];
    if (rejected.length > 0) {
      logger.warn({ rejected }, 'revalidate rejected paths — worker/web allowlist drift?');
    }
  } catch (err) {
    logger.warn(
      { paths, err: err instanceof Error ? err.message : String(err) },
      'revalidate call failed — ISR timer is the fallback',
    );
  }
}
