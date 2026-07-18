/**
 * Shared `ImageResponse` wrapper for every `/api/og/*` route (design doc §10.5).
 *
 * SPEC-GAP(WS8-T1): §10.5 says "edge runtime"; §2.2's own route table softens that to "edge
 * OK" for OG images specifically. Our DB/Redis clients (`pg` node-postgres, `ioredis`, both
 * used by every OG template to fetch the entity + rate-limit) open real TCP sockets, which
 * the edge runtime does not support. `next/og`'s `ImageResponse` auto-selects a Node-
 * compatible satori/resvg build when `NEXT_RUNTIME !== 'edge'` (see
 * `next/dist/server/og/image-response.js`), so running these routes on `runtime = 'nodejs'`
 * is a supported configuration, not a workaround — it trades edge latency for DB
 * compatibility. Documented here and in the PR description per §0.2's SPEC-GAP rule.
 */
import { ImageResponse } from 'next/og';
import type { ReactElement } from 'react';
import { OG_CACHE_S_MAXAGE_S } from '@receipts/core';
import { OG_HEIGHT, OG_WIDTH } from './components';

/** `s-maxage=<OG_CACHE_S_MAXAGE_S>, immutable` (§10.5): content-addressed URLs never change. */
export function renderOgImage(element: ReactElement): ImageResponse {
  return new ImageResponse(element, {
    width: OG_WIDTH,
    height: OG_HEIGHT,
    headers: {
      'cache-control': `public, s-maxage=${OG_CACHE_S_MAXAGE_S}, immutable`,
    },
  });
}
