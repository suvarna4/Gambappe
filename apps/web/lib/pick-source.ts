/**
 * §6.2 step 1: `source` is NEVER client-supplied — the server derives it from the signed
 * landing context. Share links carry `?r=<opaque signed token>` minted into card URLs (§10.5)
 * and echoed by the client as a header; invalid/absent → `web`/`spectator_page` by referer path.
 *
 * SPEC-GAP(WS3-T2): share-card link minting/signing is WS8 scope (not built this wave) — no
 * token format exists yet to verify against. The header check below is wired and ready for
 * WS8's format; until then it only fires if a client sends it, which none do yet, so this
 * degrades to the referer-based heuristic. `spectator_page` is inferred from the referer being
 * the question's own permalink (`/q/:slug`) — i.e. picking from that question's public page,
 * as opposed to a general app surface (home, another page) which is `web`.
 */
const SHARE_TOKEN_HEADER = 'x-receipts-share-r';

export type DerivedPickSource = 'web' | 'share_card' | 'spectator_page';

export function derivePickSource(request: Request, questionSlug: string): DerivedPickSource {
  const shareToken = request.headers.get(SHARE_TOKEN_HEADER);
  if (shareToken) return 'share_card';

  const referer = request.headers.get('referer');
  if (referer) {
    try {
      const refUrl = new URL(referer);
      if (refUrl.pathname === `/q/${questionSlug}`) return 'spectator_page';
    } catch {
      // malformed referer — fall through to 'web'
    }
  }
  return 'web';
}
