/**
 * The §10.5 `?v=` abuse guard, shared by every `/api/og/*` template route: the server
 * recomputes the canonical state hash from the current entity; a request whose `?v=` doesn't
 * match (including a missing `?v=`) is 302-redirected to the canonical URL and the image is
 * never rendered. This is what stops `?v=<garbage>` cache-busting from forcing unbounded
 * cold satori renders — a mismatched request costs one cheap DB read + a redirect, never a
 * render.
 */
import { NextResponse } from 'next/server';

/**
 * Returns a 302 redirect to the canonical `?v=` URL when `request`'s `v` param doesn't match
 * `canonicalHash`, or `null` when the caller should proceed to render (exact match).
 */
export function ogVersionGuard(request: Request, canonicalHash: string): NextResponse | null {
  const url = new URL(request.url);
  if (url.searchParams.get('v') === canonicalHash) return null;

  const canonical = new URL(url.pathname, url.origin);
  canonical.searchParams.set('v', canonicalHash);
  return NextResponse.redirect(canonical, 302);
}
