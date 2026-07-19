/**
 * Shared request pipeline for every `/api/cards/*` route (design doc §10.5, WS8-T2): the same
 * rate-limit → load entity (404) → `?v=` canonicalization guard (302) → render pipeline as
 * `handleOgRequest` (WS8-T1), plus two card-specific steps: parse+validate `?format=` (400 on
 * a missing/invalid value — this is a client input error, not a cache-miss, so it's rejected
 * rather than defaulted) and generate the §10.5 QR footer for the canonical page URL before
 * handing off to the (still-pure) template function.
 *
 * Reuses the exact same entity loaders as `/api/og/*` (`lib/og/entities.ts`) — a card and its
 * OG counterpart render the identical entity state, just at different dimensions with a QR
 * instead of a barcode, so there is no second loader/hash to keep in sync.
 */
import type { ReactElement } from 'react';
import { CARD_SQUARE_HEIGHT, CARD_SQUARE_WIDTH, CARD_STORY_HEIGHT, CARD_STORY_WIDTH } from '@receipts/core';
import { ApiError, errorEnvelope, nowMs, SHARE_CARD_FORMAT, type ShareCardFormat } from '@receipts/core';
import { clientIpKey, enforceRateLimit } from '@/lib/rate-limit';
import { ogVersionGuard } from './guard';
import { renderCardImage } from './render';
import { absoluteUrl } from './paths';
import { generateQrDataUri } from './qr';
import type { CardRenderOptions } from './templates';

function errorResponse(err: ApiError): Response {
  return Response.json(errorEnvelope(err), {
    status: err.status,
    headers: { 'x-server-time': String(nowMs()) },
  });
}

const CARD_DIMS: Record<ShareCardFormat, { width: number; height: number }> = {
  story: { width: CARD_STORY_WIDTH, height: CARD_STORY_HEIGHT },
  square: { width: CARD_SQUARE_WIDTH, height: CARD_SQUARE_HEIGHT },
};

function parseFormat(request: Request): ShareCardFormat | null {
  const raw = new URL(request.url).searchParams.get('format');
  if (raw && (SHARE_CARD_FORMAT as readonly string[]).includes(raw)) return raw as ShareCardFormat;
  return null;
}

export async function handleCardRequest<T>(
  request: Request,
  load: () => Promise<{ data: T; hash: string } | null>,
  pagePathFor: (data: T) => string,
  render: (data: T, cardOptions: CardRenderOptions) => ReactElement,
): Promise<Response> {
  const rateLimited = await enforceRateLimit('images', clientIpKey(request.headers));
  if (rateLimited) return rateLimited;

  const format = parseFormat(request);
  if (!format) {
    return errorResponse(
      new ApiError('VALIDATION_FAILED', `format must be one of: ${SHARE_CARD_FORMAT.join(', ')}`),
    );
  }

  const loaded = await load();
  if (!loaded) return errorResponse(new ApiError('NOT_FOUND', 'not found'));

  const redirect = ogVersionGuard(request, loaded.hash);
  if (redirect) return redirect;

  const path = pagePathFor(loaded.data);
  const qrDataUri = await generateQrDataUri(absoluteUrl(path));
  const dims = CARD_DIMS[format];

  return renderCardImage(render(loaded.data, { ...dims, qrDataUri }), dims);
}
