'use client';

/**
 * `/duo` — the claimed viewer's own duo hub (design doc §19.3 WS7-T7 deliverables: "current
 * duo status (queued/matched/active)"; §8.5 pairing/§9.2 endpoints). Not in the design doc's
 * §10.1 route table (only `/duos/[id]` and `/ladder` are listed there, both public) — this
 * route is this task's own addition, same pattern as WS7-T6's `/nemesis` hub and WS7-T9's
 * `/settings`: `GET /duo/current` and `POST`/`DELETE /duo/queue` are all `claimed`-auth
 * endpoints (§9.2) with no viewer-specific data allowed on the public `/duos/[id]` route
 * (INV-10), so they need a private home.
 *
 * Claim-gated like every other "me" surface (`SettingsClient.tsx`'s own header): an unclaimed
 * visitor (ghost or fully anonymous) sees the same `ClaimEntry` used by `/claim` and claim
 * prompts, inline.
 *
 * SPEC-GAP(ws7-t7): §9.2 has no endpoint to ask "am I currently in the duo queue" — only
 * `POST`/`DELETE /duo/queue` (act) and `GET /duo/current` (only surfaces a MATCHED duo, never
 * a waiting queue entry). So this component can't tell "never queued" apart from "queued in an
 * earlier visit, not yet matched" on page load — both render the same "join queue" button. If
 * the visitor is in fact already queued, clicking it hits `joinDuoQueue`'s idempotent path
 * (`ELIGIBILITY_NOT_MET` / `already_queued`, `duo-queue.ts`'s `eligibilityError`), which this
 * component treats as confirmation (switches to the "queued" view) rather than an error. A
 * dedicated `GET /duo/queue` status endpoint would close this gap but needs a
 * `packages/core` contract-change PR outside this task's scope.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { z } from 'zod';
import { DUO_MIN_PICKS } from '@receipts/core';
import type { getCurrentDuoResponseSchema, getMeResponseSchema } from '@receipts/core';
import ClaimEntry from '@/components/claim/ClaimEntry';
import { TicketCard } from '@receipts/ui';
import { duoCopy } from '@/lib/copy';
import { ApiClientError, fetchMe } from '@/lib/pick-client';
import { fetchCurrentDuo, joinDuoQueue, leaveDuoQueue } from '@/lib/duo-client';
import { DuoCard, type DuoPublic } from './DuoCard';
import { DuoDisbandButton } from './DuoDisbandButton';

type MeResponse = z.infer<typeof getMeResponseSchema>;
type CurrentDuo = z.infer<typeof getCurrentDuoResponseSchema>;
type DuoMatch = NonNullable<CurrentDuo['match']>;

const EMPTY_CURRENT: CurrentDuo = { duo: null, match: null };

type Phase = 'loading' | 'not-claimed' | 'ready' | 'error';
type QueuePhase = 'idle' | 'joining' | 'queued' | 'leaving';

export default function DuoHubClient() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [me, setMe] = useState<MeResponse | null>(null);
  const [current, setCurrent] = useState<CurrentDuo>(EMPTY_CURRENT);
  const [queuePhase, setQueuePhase] = useState<QueuePhase>('idle');
  const [actionError, setActionError] = useState<string | null>(null);

  const loadCurrent = useCallback(async () => {
    try {
      const { data } = await fetchCurrentDuo();
      setCurrent(data);
    } catch {
      // Best-effort — a failed refresh leaves the previous (possibly stale) state rather than
      // crashing the hub; the surrounding `phase === 'ready'` chrome still renders.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchMe()
      .then(async ({ data }) => {
        if (cancelled) return;
        if (!data.claim.claimed) {
          setPhase('not-claimed');
          return;
        }
        setMe(data);
        await loadCurrent();
        if (cancelled) return;
        setPhase('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiClientError && err.code === 'UNAUTHENTICATED') {
          setPhase('not-claimed');
        } else {
          setPhase('error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [loadCurrent]);

  async function handleJoin() {
    setActionError(null);
    setQueuePhase('joining');
    try {
      await joinDuoQueue();
      setQueuePhase('queued');
    } catch (err) {
      if (
        err instanceof ApiClientError &&
        err.code === 'ELIGIBILITY_NOT_MET' &&
        typeof err.details === 'object' &&
        err.details !== null &&
        (err.details as { reason?: string }).reason === 'already_queued'
      ) {
        // See file header SPEC-GAP: no way to distinguish this from a fresh join, so treat it
        // as the same success state.
        setQueuePhase('queued');
        return;
      }
      setQueuePhase('idle');
      setActionError(duoCopy.joinQueueError);
    }
  }

  async function handleLeave() {
    setActionError(null);
    setQueuePhase('leaving');
    try {
      await leaveDuoQueue();
      setQueuePhase('idle');
    } catch (err) {
      // A 404 (`NOT_FOUND`, "you are not currently in the duo queue") means the desired end
      // state is already true — treat it as success, same rationale as `DuoDisbandButton`.
      if (err instanceof ApiClientError && err.code === 'NOT_FOUND') {
        setQueuePhase('idle');
        return;
      }
      setQueuePhase('queued');
      setActionError(duoCopy.leaveQueueError);
    }
  }

  if (phase === 'loading') {
    return <div className="min-h-11" data-testid="duo-hub-loading" aria-hidden="true" />;
  }

  if (phase === 'error') {
    return (
      <p className="text-loss text-sm" data-testid="duo-hub-error">
        {duoCopy.loadError}
      </p>
    );
  }

  if (phase === 'not-claimed') {
    return (
      <div className="space-y-4" data-testid="duo-hub-not-claimed">
        <p className="text-muted text-sm">{duoCopy.claimRequiredNotice}</p>
        <ClaimEntry presentation="inline" />
      </div>
    );
  }

  // phase === 'ready'
  const profile = me!;
  const gradedPicks = profile.eligibility.graded_picks;
  const duoEligible = profile.eligibility.duo_eligible;

  return (
    <div className="space-y-6" data-testid="duo-hub-ready">
      {current.duo ? (
        <DuoActiveSection
          duo={current.duo}
          match={current.match}
          viewerProfileId={profile.profile.profile_id}
          onDisbanded={loadCurrent}
        />
      ) : !duoEligible ? (
        <p className="text-muted text-sm" data-testid="duo-not-eligible">
          {duoCopy.notEligible(gradedPicks, DUO_MIN_PICKS)}
        </p>
      ) : queuePhase === 'queued' || queuePhase === 'leaving' ? (
        <div className="space-y-3" data-testid="duo-queued">
          <p className="text-sm">{duoCopy.queuedBody}</p>
          <button
            type="button"
            data-testid="duo-leave-queue-button"
            disabled={queuePhase === 'leaving'}
            onClick={handleLeave}
            className="border-muted text-muted rounded border px-4 py-2 text-sm font-medium disabled:opacity-40"
          >
            {queuePhase === 'leaving' ? duoCopy.leavingQueue : duoCopy.leaveQueueCta}
          </button>
        </div>
      ) : (
        <div className="space-y-3" data-testid="duo-not-queued">
          <p className="text-sm">{duoCopy.notQueuedBody}</p>
          <button
            type="button"
            data-testid="duo-join-queue-button"
            disabled={queuePhase === 'joining'}
            onClick={handleJoin}
            className="bg-side-a rounded px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            {queuePhase === 'joining' ? duoCopy.joiningQueue : duoCopy.joinQueueCta}
          </button>
        </div>
      )}

      {actionError ? (
        <p className="text-loss text-xs" role="alert" data-testid="duo-action-error">
          {actionError}
        </p>
      ) : null}

      <Link href="/ladder" className="text-side-a inline-block text-sm underline underline-offset-2">
        {duoCopy.viewLadderCta}
      </Link>
    </div>
  );
}

function DuoActiveSection({
  duo,
  match,
  viewerProfileId,
  onDisbanded,
}: {
  duo: DuoPublic;
  match: DuoMatch | null;
  viewerProfileId: string;
  onDisbanded: () => void;
}) {
  const partner = duo.partners.find((p) => p.profile_id !== viewerProfileId) ?? duo.partners[0];

  return (
    <div className="space-y-4" data-testid="duo-active">
      <DuoCard duo={duo} />

      <TicketCard>
        {match ? (
          <div className="space-y-1">
            <p className="text-muted text-xs font-semibold uppercase tracking-wide">
              {match.status === 'active' ? duoCopy.matchActiveLabel : duoCopy.matchScheduledLabel}
            </p>
            <p className="font-mono text-lg font-bold" aria-label={`Score ${match.score.a} to ${match.score.b}`}>
              {match.score.a}–{match.score.b}
            </p>
            <p className="text-muted font-mono text-xs">
              {match.window_start} – {match.window_end}
            </p>
          </div>
        ) : (
          <p className="text-muted text-sm">{duoCopy.noActiveMatch}</p>
        )}
      </TicketCard>

      <div className="flex items-center gap-4">
        <Link href={`/duos/${duo.id}`} className="text-side-a text-sm underline underline-offset-2">
          {duoCopy.viewDuoCta}
        </Link>
        <DuoDisbandButton duoId={duo.id} partnerHandle={partner.handle} onDisbanded={onDisbanded} />
      </div>
    </div>
  );
}
