'use client';

import { useState } from 'react';
import { nemesisCopy } from '@/lib/copy';
import type { RematchStatus } from '@/lib/nemesis/types';
import type { VerdictOutcome } from './VerdictCard';
import { VerdictSwipeCard } from './VerdictSwipeCard';

/** The reduced rematch state `GET /me/nemesis-history` now folds into each history entry
 * (`nemesisRematchStateSchema`, `@receipts/core`, WS5-T5 contract-change) — the viewer's most
 * relevant rematch request with THIS row's opponent, if any. */
export interface RematchState {
  id: string;
  direction: 'outgoing' | 'incoming';
  status: RematchStatus;
}

/** SW10-T2: the verdict-card data for this history row, derived server-side (`app/nemesis/page.tsx`
 * + `lib/nemesis/verdict.ts`) from the entry's own `my_score`/`their_score` plus the pairing's
 * `GET /pairings/:id` scoreboard. `null` for a `cancelled` week — `VerdictOutcome` has no
 * cancelled member, so that row keeps the pre-SW10 plain "Request rematch" button below. No
 * `dayResults` here (design-diff audit): that strip now renders on `NemesisHeadToHeadBanner`,
 * a sibling of this panel, not inside `VerdictCard` — see that component's own header. */
export interface RematchVerdict {
  outcome: VerdictOutcome;
  youWins: number;
  opponentWins: number;
  scoreMargin: number;
}

export interface RematchPanelProps {
  viewerProfileId: string;
  opponent: { profile_id: string; handle: string };
  /** Initial state from the page's own `GET /me/nemesis-history` load (server-rendered) —
   * `null` when no rematch request exists yet between the viewer and this opponent. */
  rematchRequest: RematchState | null;
  verdict: RematchVerdict | null;
  className?: string;
}

type ConfirmPhase = 'idle' | 'confirming';

const BASE = '/api/v1/rematch-requests';

/** Matches the §9.1 error envelope shape `{error: {code, message}}` without importing the
 * `ApiError` class from `@receipts/core` — `@receipts/core` has a `node:crypto`-importing
 * module (WS9-T1's `notifications.ts`) and only one export path (no subpaths), so any
 * client-bundled import from it fails webpack; a plain `fetch()` + hand-rolled envelope parse
 * sidesteps that entirely (same posture the mock-backed version of this component used). */
async function readJson<T>(res: Response): Promise<T> {
  const body = (await res.json()) as { data?: T; error?: { message?: string } };
  if (!res.ok) throw new Error(body.error?.message ?? `request failed (${res.status})`);
  return body.data as T;
}

interface RematchRequestWire {
  id: string;
  requester_profile_id: string;
  target_profile_id: string;
  status: RematchStatus;
}

/**
 * The rematch-request flow (button + confirmation + pending/incoming state; design doc §8.4
 * step 0, §9.2 `POST /rematch-requests` + `/accept|decline`, real endpoints as of WS5-T5 —
 * replaces this component's original `/api/mock/nemesis/rematch-requests*` wiring). "Mutual
 * accept" = the requester's creation call (implicit consent) + the target's explicit accept
 * (only the target may accept/decline, enforced server-side). Acceptance does not create a
 * pairing on the spot — the real `nemesis:assign` batch (Monday 09:00 ET) does that — so this
 * panel's copy says "you'll be paired starting next week," never "paired now."
 *
 * SW10-T2: once there's no actionable existing request (the terminal "ask for a rematch" state),
 * the affordance is `VerdictSwipeCard` — right-swipe (or tap "Run it back") fires the same
 * `handleRequest` this component always called; left-swipe/"New fate" declines to ask, no call.
 * A cancelled-outcome week (`verdict === null`) keeps the original plain button + confirm dialog,
 * since `VerdictOutcome` has no cancelled member.
 */
export function RematchPanel({ viewerProfileId, opponent, rematchRequest, verdict, className = '' }: RematchPanelProps) {
  const [error, setError] = useState<string | null>(null);
  const [confirmPhase, setConfirmPhase] = useState<ConfirmPhase>('idle');
  const [state, setState] = useState<RematchState | null>(rematchRequest);
  const [busy, setBusy] = useState(false);

  function toState(wire: RematchRequestWire): RematchState {
    return {
      id: wire.id,
      direction: wire.requester_profile_id === viewerProfileId ? 'outgoing' : 'incoming',
      status: wire.status,
    };
  }

  async function handleRequest() {
    if (busy) return; // guards the verdict-card swipe/tap against a double-fire (fable review of PR #84)
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(BASE, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ target_profile_id: opponent.profile_id }),
      });
      const { request } = await readJson<{ request: RematchRequestWire }>(res);
      setState(toState(request));
      setConfirmPhase('idle');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  async function respond(action: 'accept' | 'decline') {
    if (!state) return;
    setError(null);
    try {
      const res = await fetch(`${BASE}/${state.id}/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      });
      const { request } = await readJson<{ request: RematchRequestWire }>(res);
      setState(toState(request));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    }
  }

  // An incoming, still-open request from THIS opponent takes priority over any outgoing
  // affordance — you accept/decline before you'd ever see a "request rematch" button again.
  if (state && state.direction === 'incoming' && state.status === 'open') {
    return (
      <div className={className} data-testid="rematch-incoming">
        <p className="text-sm">{nemesisCopy.rematchIncomingLabel(opponent.handle)}</p>
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={() => void respond('accept')}
            className="bg-win text-bg rounded px-3 py-1.5 text-sm font-medium"
          >
            {nemesisCopy.rematchAcceptCta}
          </button>
          <button
            type="button"
            onClick={() => void respond('decline')}
            className="border-muted text-muted rounded border px-3 py-1.5 text-sm font-medium"
          >
            {nemesisCopy.rematchDeclineCta}
          </button>
        </div>
        {error ? <p className="text-loss mt-1 text-xs">{error}</p> : null}
      </div>
    );
  }

  if (state?.status === 'accepted') {
    return (
      <p className={`text-win text-sm ${className}`} data-testid="rematch-accepted">
        {nemesisCopy.rematchAcceptedLabel}
      </p>
    );
  }

  if (state?.direction === 'incoming' && state.status === 'declined') {
    return (
      <p className={`text-muted text-sm ${className}`} data-testid="rematch-declined">
        {nemesisCopy.rematchDeclinedLabel}
      </p>
    );
  }

  if (state?.direction === 'outgoing' && state.status === 'open') {
    return (
      <p className={`text-muted text-sm ${className}`} data-testid="rematch-pending">
        {nemesisCopy.rematchPendingLabel(opponent.handle)}
      </p>
    );
  }

  // SW10-T2: no actionable existing request — the terminal "ask for a rematch" state.
  // Non-cancelled outcomes (`verdict` non-null) get the swipeable verdict close (right = "Run it
  // back" = this same `handleRequest`, left = "New fate" = decline to ask, no call); the swipe
  // and the tap wells commit immediately, so there's no separate confirm step here the way the
  // old plain-button flow needed one. A cancelled week (`verdict === null` — `VerdictOutcome` has
  // no cancelled member) falls through to that original plain button + confirm dialog.
  if (verdict) {
    return (
      <div className={className}>
        <VerdictSwipeCard
          outcome={verdict.outcome}
          opponentHandle={opponent.handle}
          youWins={verdict.youWins}
          opponentWins={verdict.opponentWins}
          scoreMargin={verdict.scoreMargin}
          onRunItBack={() => void handleRequest()}
          onNewFate={() => {}}
          disabled={busy}
          className="flex flex-1 flex-col"
        />
        {error ? (
          <p className="text-loss mt-1 text-xs" data-testid="rematch-error">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  if (confirmPhase === 'confirming') {
    return (
      <div className={className} data-testid="rematch-confirm">
        <p className="text-sm">Rematch {opponent.handle}?</p>
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={() => void handleRequest()}
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
