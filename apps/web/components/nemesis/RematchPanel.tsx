'use client';

import { useEffect, useState } from 'react';
import { nemesisCopy } from '@/lib/copy';
import type { RematchRequest } from '@/lib/nemesis/types';

export interface RematchPanelProps {
  viewerProfileId: string;
  opponent: { profile_id: string; handle: string };
  className?: string;
}

type ConfirmPhase = 'idle' | 'confirming';

const BASE = '/api/mock/nemesis/rematch-requests';

/** Matches the §9.1 error envelope shape `{error: {code, message}}` without importing the
 * `ApiError` class from `@receipts/core` — see this file's SPEC-GAP note below for why. */
async function readJson<T>(res: Response): Promise<T> {
  const body = (await res.json()) as { data?: T; error?: { message?: string } };
  if (!res.ok) throw new Error(body.error?.message ?? `request failed (${res.status})`);
  return body.data as T;
}

/**
 * The rematch-request flow (button + confirmation + pending-request state; design doc §8.4
 * step 0, §9.2 `POST /rematch-requests` + `/accept|decline`). "Mutual accept" = the
 * requester's creation call (implicit consent) + the target's explicit accept (the mock
 * routes below enforce only the target may accept/decline). Acceptance does not create a
 * pairing on the spot — the real `nemesis:assign` batch (Monday 09:00 ET) does that — so this
 * panel's copy says "you'll be paired starting next week," never "paired now."
 *
 * SPEC-GAP(WS7-T6): talks to `/api/mock/nemesis/rematch-requests*` — MOCK-ONLY routes (see
 * their file headers) that wrap `lib/nemesis/mock-api.ts` server-side, not the real
 * `/api/v1/rematch-requests*` (WS5-T5, not built). This component intentionally imports
 * nothing from `@receipts/core` or `mock-api.ts` directly: `@receipts/core` gained a
 * `notifications.ts` module (WS9-T1) that imports `node:crypto`, and since `@receipts/core`
 * has only one export path (no subpaths), any client-bundled import from it fails webpack —
 * routing through a server-side API boundary sidesteps that entirely, and is what a real
 * integration would do anyway (fetch, not a shared in-process function call).
 */
export function RematchPanel({ viewerProfileId, opponent, className = '' }: RematchPanelProps) {
  const [error, setError] = useState<string | null>(null);
  const [confirmPhase, setConfirmPhase] = useState<ConfirmPhase>('idle');
  const [loaded, setLoaded] = useState(false);
  const [outgoing, setOutgoing] = useState<RematchRequest | null>(null);
  const [incoming, setIncoming] = useState<RematchRequest | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [out, inc] = await Promise.all([
          fetch(
            `${BASE}/outgoing?requester_profile_id=${encodeURIComponent(viewerProfileId)}&target_profile_id=${encodeURIComponent(opponent.profile_id)}`,
          ).then((r) => readJson<{ request: RematchRequest | null }>(r)),
          fetch(`${BASE}/incoming?profile_id=${encodeURIComponent(viewerProfileId)}`).then((r) =>
            readJson<{ request: RematchRequest | null }>(r),
          ),
        ]);
        if (cancelled) return;
        setOutgoing(out.request);
        setIncoming(inc.request?.requester_profile_id === opponent.profile_id ? inc.request : null);
      } catch {
        // Best-effort — leave both null (renders the default "Request rematch" state).
      } finally {
        if (!cancelled) setLoaded(true);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [viewerProfileId, opponent.profile_id]);

  async function handleRequest() {
    setError(null);
    try {
      const res = await fetch(BASE, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          requester_profile_id: viewerProfileId,
          target_profile_id: opponent.profile_id,
        }),
      });
      const { request } = await readJson<{ request: RematchRequest }>(res);
      setOutgoing(request);
      setConfirmPhase('idle');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    }
  }

  async function handleAccept() {
    if (!incoming) return;
    setError(null);
    try {
      const res = await fetch(`${BASE}/${incoming.id}/accept`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ acting_profile_id: viewerProfileId }),
      });
      const { request } = await readJson<{ request: RematchRequest }>(res);
      setIncoming(request);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    }
  }

  async function handleDecline() {
    if (!incoming) return;
    setError(null);
    try {
      const res = await fetch(`${BASE}/${incoming.id}/decline`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ acting_profile_id: viewerProfileId }),
      });
      const { request } = await readJson<{ request: RematchRequest }>(res);
      setIncoming(request);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    }
  }

  if (!loaded) {
    return <div className={className} data-testid="rematch-loading" aria-hidden="true" />;
  }

  // An incoming request from THIS opponent takes priority over showing an outgoing-request
  // affordance — you can't simultaneously ask for and be asked for the same rematch in this
  // mock's model (a real system would just show both, but that's not reachable here).
  if (incoming && incoming.status === 'open') {
    return (
      <div className={className} data-testid="rematch-incoming">
        <p className="text-sm">{nemesisCopy.rematchIncomingLabel(opponent.handle)}</p>
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={handleAccept}
            className="bg-win text-bg rounded px-3 py-1.5 text-sm font-medium"
          >
            {nemesisCopy.rematchAcceptCta}
          </button>
          <button
            type="button"
            onClick={handleDecline}
            className="border-muted text-muted rounded border px-3 py-1.5 text-sm font-medium"
          >
            {nemesisCopy.rematchDeclineCta}
          </button>
        </div>
        {error ? <p className="text-loss mt-1 text-xs">{error}</p> : null}
      </div>
    );
  }

  if (incoming?.status === 'accepted') {
    return (
      <p className={`text-win text-sm ${className}`} data-testid="rematch-accepted">
        {nemesisCopy.rematchAcceptedLabel}
      </p>
    );
  }

  if (incoming?.status === 'declined') {
    return (
      <p className={`text-muted text-sm ${className}`} data-testid="rematch-declined">
        {nemesisCopy.rematchDeclinedLabel}
      </p>
    );
  }

  if (outgoing?.status === 'open') {
    return (
      <p className={`text-muted text-sm ${className}`} data-testid="rematch-pending">
        {nemesisCopy.rematchPendingLabel(opponent.handle)}
      </p>
    );
  }

  if (outgoing?.status === 'accepted') {
    return (
      <p className={`text-win text-sm ${className}`} data-testid="rematch-accepted">
        {nemesisCopy.rematchAcceptedLabel}
      </p>
    );
  }

  if (confirmPhase === 'confirming') {
    return (
      <div className={className} data-testid="rematch-confirm">
        <p className="text-sm">Rematch {opponent.handle}?</p>
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={handleRequest}
            className="bg-side-a text-bg rounded px-3 py-1.5 text-sm font-medium"
          >
            Yes, request it
          </button>
          <button
            type="button"
            onClick={() => setConfirmPhase('idle')}
            className="text-muted text-sm underline underline-offset-2"
          >
            Cancel
          </button>
        </div>
        {error ? <p className="text-loss mt-1 text-xs">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setConfirmPhase('confirming')}
        className="border-side-a text-side-a rounded border px-3 py-1.5 text-sm font-medium"
        data-testid="rematch-request-button"
      >
        {nemesisCopy.requestRematchCta}
      </button>
      {error ? <p className="text-loss mt-1 text-xs">{error}</p> : null}
    </div>
  );
}
