'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PairingReactionEmoji } from '@receipts/core';
import { ApiClientError, fetchMe } from '@/lib/pick-client';
import { submitPairingReaction } from '@/lib/nemesis/reactions-client';
import { ReactionStamps } from './ReactionStamps';

export interface ReactionStampsPanelProps {
  pairingId: string;
  /** Public, viewer-free per-player stamps straight off the pairing payload
   * (`pairing.today_reactions`) — safe from either page, including `/vs/[pairingId]`'s ISR
   * render. Used ONLY as the write path's optimistic-update seed; the per-side READ display
   * lives in `NemesisMatchupCard`'s `SideBlock`, not here (see that file's header). */
  stamps: { a: PairingReactionEmoji | null; b: PairingReactionEmoji | null } | null | undefined;
  /** The pairing's own two participant ids (`pairing.a.profile_id`/`.b.profile_id`) — public,
   * already part of the payload every visitor receives. Matched client-side against the
   * viewer's own `/me` profile id to derive `selected`/whether the viewer can react at all. */
  sideProfileIds: { a: string; b: string };
  className?: string;
}

type MeState =
  | { status: 'loading' }
  | { status: 'ready'; profileId: string; kind: string }
  | { status: 'error' };

/**
 * SW10-T4 (wiring-gaps doc §4): the viewer's own interactive `ReactionStamps` picker for a
 * nemesis matchup. Entirely a client island — same "self-fetch identity post-hydration"
 * posture as `QuestionThread`/`ViewerStrip` (§10.2, INV-10): this component's initial render
 * (both server-rendered HTML and the client's first paint before hydration effects run) is
 * ALWAYS the neutral/read-only state — `me` starts at `{status: 'loading'}`, never derived from
 * a prop or cookie — so nothing viewer-specific is ever present in the SSR output, on EITHER
 * page this mounts on. `/vs/[pairingId]` additionally guarantees this structurally
 * (`viewerProfileId` is hardcoded `null` there, INV-10), but this component doesn't rely on
 * that — it derives the viewer's identity itself, the same way regardless of which page it's on.
 *
 * Gating (swipe-ux-plan §2.9 SW5-T4 AC: "ghosts see but can't send"; wiring-gaps doc §4's
 * participant-only note): interactive (`onSelect` present) only for a `claimed` profile who is
 * one of the pairing's own two participants. Everyone else (loading, error, ghost, claimed
 * non-participant/spectator) renders nothing here — the public per-side read display in
 * `NemesisMatchupCard`'s `SideBlock` already covers "see"; this panel is purely "send," and a
 * non-participant has nothing of their own to send. Server-side enforcement
 * (`apps/web/lib/nemesis/reactions.ts`) is the actual guard regardless — this client gating is
 * UX only, matching this codebase's established client-vs-server enforcement split.
 */
export function ReactionStampsPanel({ pairingId, stamps, sideProfileIds, className }: ReactionStampsPanelProps) {
  // `useRouter()` throws ("expected app router to be mounted") outside a real Next.js App
  // Router request — this repo's presentational unit tests render components with plain
  // `renderToStaticMarkup` (§10.4: no DOM/router test harness), including `NemesisMatchupCard`,
  // which mounts this panel. Called unconditionally every render either way (no hook-order
  // change), just tolerant of the one environment that doesn't provide the context.
  let router: ReturnType<typeof useRouter> | null;
  try {
    router = useRouter();
  } catch {
    router = null;
  }
  const [me, setMe] = useState<MeState>({ status: 'loading' });
  const [localStamps, setLocalStamps] = useState(stamps ?? { a: null, b: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchMe()
      .then(({ data }) => {
        if (!cancelled) setMe({ status: 'ready', profileId: data.profile.profile_id, kind: data.profile.kind });
      })
      .catch(() => {
        if (!cancelled) setMe({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setLocalStamps(stamps ?? { a: null, b: null });
  }, [stamps]);

  const viewerSide: 'a' | 'b' | null =
    me.status === 'ready' && me.profileId === sideProfileIds.a
      ? 'a'
      : me.status === 'ready' && me.profileId === sideProfileIds.b
        ? 'b'
        : null;
  const canReact = me.status === 'ready' && me.kind === 'claimed' && viewerSide !== null;

  const handleSelect = useCallback(
    async (stamp: PairingReactionEmoji) => {
      if (!viewerSide) return;
      setBusy(true);
      setError(null);
      const previous = localStamps;
      setLocalStamps({ ...localStamps, [viewerSide]: stamp });
      try {
        await submitPairingReaction(pairingId, stamp);
        // Fable review of PR #91: `NemesisMatchupCard`'s `SideBlock` renders the viewer's own
        // side's read-only stamp straight off the server-provided `stamps` prop — without this,
        // that badge would keep showing the pre-post value (or nothing) until the next real
        // navigation, visibly disagreeing with this panel's own optimistic `localStamps`.
        // `router.refresh()` re-fetches the server payload so `SideBlock`'s copy catches up too.
        router?.refresh();
      } catch (err) {
        setLocalStamps(previous);
        setError(err instanceof ApiClientError ? apiErrorCopy(err) : 'Could not send that reaction — try again.');
      } finally {
        setBusy(false);
      }
    },
    [viewerSide, localStamps, pairingId, router],
  );

  if (!canReact) return null;

  return (
    <div className={className} data-testid="reaction-stamps-panel">
      <ReactionStamps selected={localStamps[viewerSide]} onSelect={handleSelect} disabled={busy} />
      {error ? (
        <p className="text-loss mt-1 text-xs" data-testid="reaction-stamps-panel-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function apiErrorCopy(err: ApiClientError): string {
  if (err.code === 'FORBIDDEN') return "You can't react to this matchup.";
  if (err.code === 'RATE_LIMITED') return 'Too many attempts — try again shortly.';
  return 'Could not send that reaction — try again.';
}
