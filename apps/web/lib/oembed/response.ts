/**
 * Builds the actual oEmbed JSON body once `route-matcher.ts` has decided `url=` matches a known
 * route shape on our own host (design doc §10.5: "returns rich type with the OG image"). This
 * is the ONLY place in the oEmbed feature that touches the database — it re-fetches the entity
 * via the exact same WS8-T1 loaders `/api/og/*` already uses (`apps/web/lib/og/entities.ts`),
 * so a syntactically-matching but nonexistent slug/id still resolves to `null` (→ 404 at the
 * route), and the thumbnail's `?v=` hash is always the same canonical value the OG route itself
 * would redirect a caller to.
 */
import { PRODUCT_NAME } from '@receipts/core';
import type { Db } from '@receipts/db';
import { loadDuoOg, loadMatchupOg, loadProfileOg, loadQuestionOg } from '@/lib/og/entities';
import { OG_HEIGHT, OG_WIDTH } from '@/lib/og/components';
import type { OembedRouteMatch } from './route-matcher';

const PROVIDER_NAME = PRODUCT_NAME;

export interface OembedResponseBody {
  type: 'rich';
  version: '1.0';
  title: string;
  provider_name: string;
  provider_url: string;
  width: number;
  height: number;
  html: string;
  thumbnail_url: string;
  thumbnail_width: number;
  thumbnail_height: number;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function finish(appOrigin: string, title: string, ogPath: string, hash: string): OembedResponseBody {
  const thumbnailUrl = `${appOrigin}${ogPath}?v=${hash}`;
  return {
    type: 'rich',
    version: '1.0',
    title,
    provider_name: PROVIDER_NAME,
    provider_url: appOrigin,
    width: OG_WIDTH,
    height: OG_HEIGHT,
    // A minimal embeddable snippet ("rich" type per the oEmbed spec requires `html`) — just the
    // OG image itself, same canonical content-addressed URL an unfurler would already resolve
    // from the page's `og:image` meta tag.
    html: `<img src="${escapeHtml(thumbnailUrl)}" width="${OG_WIDTH}" height="${OG_HEIGHT}" alt="${escapeHtml(title)}" />`,
    thumbnail_url: thumbnailUrl,
    thumbnail_width: OG_WIDTH,
    thumbnail_height: OG_HEIGHT,
  };
}

/** Returns `null` when `match`'s id/slug doesn't resolve to a real row — the route turns that
 * into the same 404 a bad pattern-match gets (§19.3 AC: "a syntactically-matching but
 * nonexistent slug should still 404"). */
export async function buildOembedResponse(
  db: Db,
  match: OembedRouteMatch,
  appOrigin: string,
): Promise<OembedResponseBody | null> {
  switch (match.kind) {
    case 'question': {
      const loaded = await loadQuestionOg(db, match.id);
      if (!loaded) return null;
      return finish(
        appOrigin,
        loaded.data.question.headline,
        `/api/og/question/${encodeURIComponent(match.id)}`,
        loaded.hash,
      );
    }
    case 'profile': {
      const loaded = await loadProfileOg(db, match.id);
      if (!loaded) return null;
      // §10.5 pinned convention: og:title = headline or "{handle}'s receipt".
      return finish(
        appOrigin,
        `${loaded.data.profile.handle}'s receipt`,
        `/api/og/profile/${encodeURIComponent(match.id)}`,
        loaded.hash,
      );
    }
    case 'matchup': {
      const loaded = await loadMatchupOg(db, match.id);
      if (!loaded) return null;
      return finish(
        appOrigin,
        `${loaded.data.profileA.handle} vs ${loaded.data.profileB.handle}`,
        `/api/og/matchup/${encodeURIComponent(match.id)}`,
        loaded.hash,
      );
    }
    case 'duo': {
      const loaded = await loadDuoOg(db, match.id);
      if (!loaded) return null;
      return finish(
        appOrigin,
        `${loaded.data.profileA.handle} & ${loaded.data.profileB.handle}`,
        `/api/og/duo/${encodeURIComponent(match.id)}`,
        loaded.hash,
      );
    }
    default: {
      const exhaustive: never = match.kind;
      throw new Error(`unreachable oEmbed match kind: ${String(exhaustive)}`);
    }
  }
}
