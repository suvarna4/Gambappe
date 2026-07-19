/**
 * Shared request pipeline for every `/api/og/*` route (design doc §10.5, §14.1): rate limit →
 * load entity (404 if missing) → `?v=` canonicalization guard (302 if mismatched) → render.
 * Order matters: the rate limit runs first so a flood of garbage ids never reaches the DB
 * (§14.1 "GETs of public resources" backstop reasoning applies here too), and the entity
 * fetch runs before the `?v=` check so a request for a real, current URL never redirects
 * (only a stale/forged `v` does).
 */
import type { ReactElement } from 'react';
import { ApiError, errorEnvelope, nowMs } from '@receipts/core';
import { clientIpKey, enforceRateLimit } from '@/lib/rate-limit';
import { ogVersionGuard } from './guard';
import { renderOgImage } from './render';

function notFound(): Response {
  const err = new ApiError('NOT_FOUND', 'not found');
  return Response.json(errorEnvelope(err), {
    status: err.status,
    headers: { 'x-server-time': String(nowMs()) },
  });
}

export async function handleOgRequest<T>(
  request: Request,
  load: () => Promise<{ data: T; hash: string } | null>,
  render: (data: T) => ReactElement,
): Promise<Response> {
  const rateLimited = await enforceRateLimit('images', clientIpKey(request.headers));
  if (rateLimited) return rateLimited;

  const loaded = await load();
  if (!loaded) return notFound();

  const redirect = ogVersionGuard(request, loaded.hash);
  if (redirect) return redirect;

  return renderOgImage(render(loaded.data));
}
