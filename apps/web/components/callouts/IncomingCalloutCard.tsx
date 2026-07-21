'use client';

/**
 * WS20-T4 (journeys plan §5, D-J5) · The incoming call-out card the `/rivals` hub shows when the
 * viewer arrives with `?callout={token}` (the URL WS20-T3 mints). Renders the `TapeLabel`
 * "YOU'VE BEEN CALLED OUT", the challenger + a link to their public record, and Accept / Decline.
 *
 * Accept routing (§5):
 *  - a CLAIMED viewer `POST`s `/api/v1/callouts/{token}/accept`; on success the hub re-renders
 *    (`router.refresh()`) and the new pairing shows as the "locked in" card (both sides — §5 AC).
 *  - a GHOST/anonymous viewer is routed through the Save flow with a `?next=` return
 *    (`/claim?next=/rivals?callout={token}`), so after saving they land right back here to accept
 *    (D-J8). The server also enforces this: a ghost `POST` gets 401 `{reason:'save_required'}`
 *    (WS20-T3), which this card treats identically by redirecting to Save.
 *
 * Terminal/expired states (`accepted`, `declined`, `expired`, `not_found`) render their stamp line
 * with no actions. No free-text input anywhere (§5 AC).
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { TapeLabel } from '@receipts/ui';
import { calloutsCopy } from '@/lib/copy';

export type IncomingCalloutState =
  | { kind: 'pending'; challengerHandle: string; challengerSlug: string }
  | { kind: 'accepted'; challengerHandle: string; challengerSlug: string }
  | { kind: 'declined'; challengerHandle: string; challengerSlug: string }
  | { kind: 'expired' }
  | { kind: 'not_found' };

export interface IncomingCalloutCardProps {
  token: string;
  isClaimed: boolean;
  initial: IncomingCalloutState;
}

interface RespondWire {
  error?: { message?: string };
  reason?: string;
}

export function IncomingCalloutCard({ token, isClaimed, initial }: IncomingCalloutCardProps) {
  const router = useRouter();
  const [state, setState] = useState<IncomingCalloutState>(initial);
  const [busy, setBusy] = useState<null | 'accept' | 'decline'>(null);
  const [error, setError] = useState<string | null>(null);

  const saveUrl = `/claim?next=${encodeURIComponent(`/rivals?callout=${token}`)}`;

  async function respond(action: 'accept' | 'decline') {
    if (busy) return;
    // Ghost accepting → Save flow first (D-J8). Decline needs a claimed session too (server is
    // claimed-only), so a ghost decline also routes through Save.
    if (!isClaimed) {
      window.location.href = saveUrl;
      return;
    }
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(`/api/v1/callouts/${token}/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
      });
      if (res.status === 401) {
        const body = (await res.json().catch(() => ({}))) as RespondWire;
        if (body.reason === 'save_required') {
          window.location.href = saveUrl;
          return;
        }
      }
      if (res.status === 410) {
        setState({ kind: 'expired' });
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as RespondWire;
        throw new Error(body.error?.message ?? 'callout respond failed');
      }
      if (action === 'accept') {
        setState((prev) =>
          prev.kind === 'pending' ? { ...prev, kind: 'accepted' } : prev,
        );
        // Re-render the server hub so the "locked in" pairing card appears (both sides, §5 AC).
        router.refresh();
      } else {
        setState((prev) => (prev.kind === 'pending' ? { ...prev, kind: 'declined' } : prev));
      }
    } catch {
      setError(calloutsCopy.respondError);
    } finally {
      setBusy(null);
    }
  }

  if (state.kind === 'expired') {
    return (
      <CalloutNotice testId="incoming-callout-expired" tape={calloutsCopy.incomingTapeLabel}>
        {calloutsCopy.expiredLine}
      </CalloutNotice>
    );
  }
  if (state.kind === 'not_found') {
    return (
      <CalloutNotice testId="incoming-callout-not-found" tape={calloutsCopy.incomingTapeLabel}>
        {calloutsCopy.notFoundLine}
      </CalloutNotice>
    );
  }
  if (state.kind === 'accepted') {
    return (
      <CalloutNotice testId="incoming-callout-accepted" tape={calloutsCopy.lockedInTapeLabel}>
        {calloutsCopy.acceptedLine(state.challengerHandle)}
      </CalloutNotice>
    );
  }
  if (state.kind === 'declined') {
    return (
      <CalloutNotice testId="incoming-callout-declined" tape={calloutsCopy.incomingTapeLabel}>
        {calloutsCopy.declinedLine}
      </CalloutNotice>
    );
  }

  // pending
  return (
    <section
      data-testid="incoming-callout-card"
      className="border-surface space-y-3 rounded-lg border p-4"
    >
      <TapeLabel>{calloutsCopy.incomingTapeLabel}</TapeLabel>
      <p className="text-base font-medium">{calloutsCopy.incomingBody(state.challengerHandle)}</p>
      <Link
        href={`/p/${state.challengerSlug}`}
        className="text-muted inline-block text-xs underline underline-offset-2"
        data-testid="incoming-callout-record-link"
      >
        {calloutsCopy.challengerRecordCta}
      </Link>

      <div className="flex gap-2 pt-1">
        {isClaimed ? (
          <button
            type="button"
            onClick={() => void respond('accept')}
            disabled={busy !== null}
            data-testid="incoming-callout-accept"
            className="bg-win text-bg rounded px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
          >
            {busy === 'accept' ? calloutsCopy.accepting : calloutsCopy.acceptCta}
          </button>
        ) : (
          <a
            href={saveUrl}
            data-testid="incoming-callout-accept"
            className="bg-win text-bg rounded px-3 py-1.5 text-sm font-semibold"
          >
            {calloutsCopy.acceptCta}
          </a>
        )}
        <button
          type="button"
          onClick={() => void respond('decline')}
          disabled={busy !== null}
          data-testid="incoming-callout-decline"
          className="border-muted text-muted rounded border px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
        >
          {busy === 'decline' ? calloutsCopy.declining : calloutsCopy.declineCta}
        </button>
      </div>

      {!isClaimed ? (
        <p className="text-muted text-xs" data-testid="incoming-callout-ghost-hint">
          {calloutsCopy.acceptGhostHint}
        </p>
      ) : null}
      {error ? (
        <p className="text-loss text-xs" data-testid="incoming-callout-error">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function CalloutNotice({
  testId,
  tape,
  children,
}: {
  testId: string;
  tape: string;
  children: React.ReactNode;
}) {
  return (
    <section data-testid={testId} className="border-surface space-y-2 rounded-lg border p-4">
      <TapeLabel>{tape}</TapeLabel>
      <p className="text-muted text-sm">{children}</p>
    </section>
  );
}
