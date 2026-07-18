'use client';

import { useState } from 'react';
import { ApiError } from '@receipts/core';
import { nemesisCopy } from '@/lib/copy';
import {
  acceptRematchRequest,
  createRematchRequest,
  declineRematchRequest,
  getIncomingRematchRequest,
  getOutgoingRematchRequest,
} from '@/lib/nemesis/mock-api';
import type { RematchRequest } from '@/lib/nemesis/types';

export interface RematchPanelProps {
  viewerProfileId: string;
  opponent: { profile_id: string; handle: string };
  className?: string;
}

type ConfirmPhase = 'idle' | 'confirming';

/**
 * The rematch-request flow (button + confirmation + pending-request state; design doc §8.4
 * step 0, §9.2 `POST /rematch-requests` + `/accept|decline`). "Mutual accept" = the
 * requester's creation call (implicit consent) + the target's explicit accept
 * (`mock-api.ts` enforces only the target may accept/decline). Acceptance does not create a
 * pairing on the spot — the real `nemesis:assign` batch (Monday 09:00 ET) does that — so this
 * panel's copy says "you'll be paired starting next week," never "paired now."
 *
 * SPEC-GAP(WS7-T6): reads/writes go straight to the in-memory `mock-api.ts` module (this is
 * a client component, so this runs in the browser's own JS runtime) rather than `fetch()`ing
 * a real endpoint — there is no `/api/v1/rematch-requests*` route on this branch (WS5-T5).
 * State here does not persist across a page reload or sync with the server-rendered
 * `/vs/[pairingId]` page, which is a real limitation of mocking client-side; a real
 * integration wouldn't have that problem since both would hit the same database.
 */
export function RematchPanel({ viewerProfileId, opponent, className = '' }: RematchPanelProps) {
  const [error, setError] = useState<string | null>(null);
  const [confirmPhase, setConfirmPhase] = useState<ConfirmPhase>('idle');
  const [outgoing, setOutgoing] = useState<RematchRequest | null>(() =>
    getOutgoingRematchRequest(viewerProfileId, opponent.profile_id),
  );
  const [incoming, setIncoming] = useState<RematchRequest | null>(() => {
    const req = getIncomingRematchRequest(viewerProfileId);
    return req?.requester_profile_id === opponent.profile_id ? req : null;
  });

  function handleRequest() {
    setError(null);
    try {
      const { request } = createRematchRequest(viewerProfileId, opponent.profile_id);
      setOutgoing(request);
      setConfirmPhase('idle');
    } catch (err) {
      setError(ApiError.is(err) ? err.message : 'Something went wrong');
    }
  }

  function handleAccept() {
    if (!incoming) return;
    setError(null);
    try {
      const { request } = acceptRematchRequest(incoming.id, viewerProfileId);
      setIncoming(request);
    } catch (err) {
      setError(ApiError.is(err) ? err.message : 'Something went wrong');
    }
  }

  function handleDecline() {
    if (!incoming) return;
    setError(null);
    try {
      const { request } = declineRematchRequest(incoming.id, viewerProfileId);
      setIncoming(request);
    } catch (err) {
      setError(ApiError.is(err) ? err.message : 'Something went wrong');
    }
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
