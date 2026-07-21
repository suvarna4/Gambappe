'use client';

/**
 * WS20-T4 (journeys plan §5, D-J5) · The grudge book's `REMATCH` affordance. Reuses the EXISTING
 * rematch mechanism (`POST /api/v1/rematch-requests` + `/{id}/accept|decline`, WS5-T5 — the same
 * endpoints `RematchPanel` drives), surfaced here as a compact stamp-style control per rival
 * rather than the full verdict-swipe card (grudge-book rows are a lifetime record, not a
 * current-week moment — same "keep history rows compact" reasoning as `NemesisHistoryList`). No
 * free-text input (§5 AC).
 *
 * Acceptance never pairs on the spot — the Monday `nemesis:assign` batch does — so the confirmed
 * copy says "paired starting next week", matching `RematchPanel`.
 */
import { useState } from 'react';
import { calloutsCopy } from '@/lib/copy';
import type { RematchStatus } from '@/lib/nemesis/types';

export interface GrudgeRematchState {
  id: string;
  direction: 'outgoing' | 'incoming';
  status: RematchStatus;
}

export interface GrudgeRematchButtonProps {
  viewerProfileId: string;
  opponent: { profile_id: string; handle: string };
  rematchRequest: GrudgeRematchState | null;
}

interface RematchRequestWire {
  id: string;
  requester_profile_id: string;
  target_profile_id: string;
  status: RematchStatus;
}

const BASE = '/api/v1/rematch-requests';

async function readData<T>(res: Response): Promise<T> {
  const body = (await res.json()) as { data?: T; error?: { message?: string } };
  if (!res.ok) throw new Error(body.error?.message ?? `request failed (${res.status})`);
  return body.data as T;
}

export function GrudgeRematchButton({ viewerProfileId, opponent, rematchRequest }: GrudgeRematchButtonProps) {
  const [state, setState] = useState<GrudgeRematchState | null>(rematchRequest);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toState(wire: RematchRequestWire): GrudgeRematchState {
    return {
      id: wire.id,
      direction: wire.requester_profile_id === viewerProfileId ? 'outgoing' : 'incoming',
      status: wire.status,
    };
  }

  async function request() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(BASE, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ target_profile_id: opponent.profile_id }),
      });
      const { request: wire } = await readData<{ request: RematchRequestWire }>(res);
      setState(toState(wire));
    } catch {
      setError(calloutsCopy.rematchError);
    } finally {
      setBusy(false);
    }
  }

  async function respond(action: 'accept' | 'decline') {
    if (!state || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/${state.id}/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
      });
      const { request: wire } = await readData<{ request: RematchRequestWire }>(res);
      setState(toState(wire));
    } catch {
      setError(calloutsCopy.rematchError);
    } finally {
      setBusy(false);
    }
  }

  if (state?.direction === 'incoming' && state.status === 'open') {
    return (
      <div className="flex flex-col items-end gap-1" data-testid="grudge-rematch-incoming">
        <p className="text-muted text-xs">{calloutsCopy.rematchIncomingLine(opponent.handle)}</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void respond('accept')}
            disabled={busy}
            className="bg-win text-bg rounded px-2 py-1 text-xs font-semibold disabled:opacity-50"
          >
            {calloutsCopy.rematchCta}
          </button>
        </div>
        {error ? <p className="text-loss text-xs">{error}</p> : null}
      </div>
    );
  }

  if (state?.status === 'accepted') {
    return (
      <p className="text-win text-xs" data-testid="grudge-rematch-accepted">
        {calloutsCopy.rematchAcceptedLine}
      </p>
    );
  }

  if (state?.direction === 'outgoing' && state.status === 'open') {
    return (
      <p className="text-muted text-xs" data-testid="grudge-rematch-pending">
        {calloutsCopy.rematchPendingLine(opponent.handle)}
      </p>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => void request()}
        disabled={busy}
        data-testid="grudge-rematch-button"
        className="border-side-a text-side-a rounded border px-3 py-1.5 text-xs font-semibold tracking-wide uppercase disabled:opacity-50"
      >
        {busy ? calloutsCopy.rematchSending : calloutsCopy.rematchCta}
      </button>
      {error ? (
        <p className="text-loss text-xs" data-testid="grudge-rematch-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
