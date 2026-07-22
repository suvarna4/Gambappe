import { notFound } from 'next/navigation';
import { isFlagEnabled } from '@receipts/core';
import { getEnabledAuthProviders } from '@/lib/auth-providers';
import DuoHubClient from '@/components/duo/DuoHubClient';
import { duoCopy } from '@/lib/copy';

/**
 * `DuoRoom` — the duo hub body (heading + `DuoHubClient`), extracted from `/duo`'s own page so it
 * can be rendered by BOTH the standalone `/duo` route (deep links/share cards — unchanged) and the
 * segmented `/rivals?tab=duo` hub (WS17-T2, journeys plan §5).
 *
 * The `duo_queue` flag gate lives HERE, inside the room, so it travels with the surface no matter
 * which host mounts it: every duo route 404s while the flag is off (§4.6, §8.5, §9.2 — matching the
 * duo API routes' own `isFlagEnabled('duo_queue')` guard). `/duo/page.tsx` renders this component
 * unconditionally and the gate still fires; the `/rivals` hub only ever routes to the duo tab when
 * the flag is enabled (it hides the Duo segment otherwise), but a forced `?tab=duo` with the flag
 * off still lands here and 404s — "respect `isFlagEnabled('duo_queue')` exactly as the current
 * `/duo` page does" (journeys plan §5 seam note). See `DuoHubClient`'s header for why the whole
 * surface is a client island (all data is viewer-specific `GET /me` / `GET /duo/current`).
 *
 * Returns a fragment — each host wraps it in its own `<main>`, so `/duo`'s rendered DOM is
 * unchanged from before the extraction.
 */
export function DuoRoom() {
  if (!isFlagEnabled('duo_queue')) notFound();

  return (
    <>
      <h1 className="text-2xl font-bold">{duoCopy.hubHeading}</h1>
      <DuoHubClient enabledProviders={getEnabledAuthProviders()} />
    </>
  );
}
