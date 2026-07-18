'use client';

import { useCallback, useEffect, useState } from 'react';
import type { MarketSide, QuestionPublic } from '@receipts/core';
import { copy } from '@/lib/copy';
import { formatEtClock } from '@/lib/format-et';
import { ApiClientError, fetchMe, placePick, undoPick } from '@/lib/pick-client';
import { canPick, canUndo, needsAgeGate } from '@/lib/pick-eligibility';
import {
  clearCachedPick,
  readCachedPick,
  writeCachedPick,
  type CachedPick,
} from '@/lib/pick-storage';
import { PickButtons } from './PickButtons';
import { QuestionThread } from './QuestionThread';
import { RevealSequence } from './RevealSequence';

export interface ViewerStripProps {
  question: QuestionPublic;
}

type MeState =
  { status: 'loading' } | { status: 'ready'; ageAttested: boolean } | { status: 'error' };

/**
 * The identity-dependent island (§10.2, INV-10): the ONLY place on the question page that
 * reads viewer state. Its React `useState` initial value is always the loading skeleton —
 * never derived from a cookie, a prop, or anything request-specific — so its server-rendered
 * HTML is identical for every visitor regardless of identity; real viewer data only appears
 * after the `GET /me` fetch resolves client-side, post-hydration (see
 * `test/question-state-view.test.tsx` for the dual-render proof this relies on).
 *
 * None of `GET /me`, `POST .../picks`, `DELETE /picks/:id`, or the poll are merged yet — see
 * `lib/pick-client.ts`'s header comment for exactly which routes are missing and why. Errors
 * from those calls (including plain network failures while unmerged) are caught and shown
 * inline; they never crash this component or the page around it.
 */
export function ViewerStrip({ question }: ViewerStripProps) {
  const [me, setMe] = useState<MeState>({ status: 'loading' });
  const [pick, setPick] = useState<CachedPick | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    // `RevealSequence` (below) owns its own identity fetch (the reveal endpoint resolves the
    // viewer server-side) — skip the unrelated `/me` round trip once a question is revealed.
    if (question.status === 'revealed') return;
    let cancelled = false;
    fetchMe()
      .then(({ data }) => {
        if (!cancelled) setMe({ status: 'ready', ageAttested: data.profile.age_attested });
      })
      .catch(() => {
        if (!cancelled) setMe({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [question.status]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setPick(readCachedPick(window.localStorage, question.id));
  }, [question.id]);

  // Ticks the undo countdown; also doubles as the local expiry check driving `canUndo` below.
  // Pointless once revealed — `RevealSequence` (below) owns rendering then, and undo/pick UI
  // never shows again — so this would otherwise re-render every second forever for no reason.
  useEffect(() => {
    if (!pick || question.status === 'revealed') return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [pick, question.status]);

  const handlePick = useCallback(
    async (side: MarketSide, ageAttested: boolean) => {
      setBusy(true);
      setError(null);
      try {
        const { data } = await placePick(question.id, {
          side,
          ...(ageAttested ? { age_attested: true as const } : {}),
        });
        const cached: CachedPick = {
          pickId: data.pick.id,
          side: data.pick.side,
          pickedAtIso: data.pick.picked_at,
          undoUntilIso: data.undo_until,
        };
        if (typeof window !== 'undefined')
          writeCachedPick(window.localStorage, question.id, cached);
        setPick(cached);
        if (ageAttested) {
          setMe((prev) => (prev.status === 'ready' ? { ...prev, ageAttested: true } : prev));
        }
      } catch (err) {
        handlePickError(err, question.id, setPick, setError);
      } finally {
        setBusy(false);
      }
    },
    [question.id],
  );

  const handleUndo = useCallback(async () => {
    if (!pick) return;
    setBusy(true);
    setError(null);
    try {
      await undoPick(pick.pickId);
      if (typeof window !== 'undefined') clearCachedPick(window.localStorage, question.id);
      setPick(null);
    } catch (err) {
      setError(
        err instanceof ApiClientError && err.code === 'UNDO_EXPIRED'
          ? copy.errors.UNDO_EXPIRED
          : copy.errors.generic,
      );
    } finally {
      setBusy(false);
    }
  }, [pick, question.id]);

  if (question.status === 'revealed') {
    return (
      <div className="space-y-4">
        {/* WS7-T3: the choreographed reveal sequence replaces the generic pick-cache view — a
            revealed question's "your pick" is a result (win/loss/streak/percentile), not a
            still-pending receipt with a now-meaningless undo control. */}
        <RevealSequence question={question} />
        {/* WS7-T8 (§10.3 `revealed` state: "thread"): the post-reveal discussion + reactions. */}
        <QuestionThread questionId={question.id} questionSlug={question.slug} />
      </div>
    );
  }

  if (me.status === 'loading') {
    // Reserved slot (§10.1: "no layout shift on hydration") — identical for every visitor.
    return <div className="min-h-11" data-testid="viewer-strip-loading" aria-hidden="true" />;
  }

  if (pick) {
    const sideLabel = pick.side === 'yes' ? question.yes_label : question.no_label;
    const undoable = canUndo(pick, nowMs, question.lock_at);
    return (
      <div className="space-y-2" data-testid="viewer-strip-pick">
        <p className="font-mono text-sm">
          {copy.question.yourPickLabel}: {sideLabel}
        </p>
        <p className="text-muted text-xs">
          {copy.question.comeBackAt(formatEtClock(question.reveal_at))}
        </p>
        {undoable ? (
          <button
            type="button"
            onClick={handleUndo}
            disabled={busy}
            data-testid="undo-pick"
            className="text-loss min-h-11 text-xs font-semibold uppercase underline disabled:opacity-50"
          >
            {copy.question.undoButton}
          </button>
        ) : null}
        {error ? (
          <p className="text-loss text-xs" data-testid="viewer-strip-error">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  if (!canPick(question.status)) {
    return null;
  }

  return (
    <div className="space-y-2" data-testid="viewer-strip-pick-buttons">
      <PickButtons
        yesLabel={question.yes_label}
        noLabel={question.no_label}
        ageGateRequired={me.status === 'ready' ? needsAgeGate(me.ageAttested) : true}
        disabled={busy}
        onPick={handlePick}
      />
      {error ? (
        <p className="text-loss text-xs" data-testid="viewer-strip-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const KNOWN_ERROR_COPY: Partial<Record<string, string>> = copy.errors;

function handlePickError(
  err: unknown,
  questionId: string,
  setPick: (pick: CachedPick | null) => void,
  setError: (message: string) => void,
): void {
  if (err instanceof ApiClientError && err.code === 'ALREADY_PICKED') {
    // Idempotent recovery (§6.2 step 5): the 409 body echoes the existing pick — repair the
    // local cache from it rather than surfacing an error (see pick-storage.ts's SPEC-GAP note).
    const details = err.details as
      { pick?: { id: string; side: MarketSide; picked_at: string } } | undefined;
    if (details?.pick && typeof window !== 'undefined') {
      const cached: CachedPick = {
        pickId: details.pick.id,
        side: details.pick.side,
        pickedAtIso: details.pick.picked_at,
        // The 409 envelope doesn't echo `undo_until` (§9.2 doesn't specify one for this path);
        // treating it as already-expired is the conservative choice — worst case we hide an
        // undo control that a fresh GET would've shown, never the reverse.
        undoUntilIso: details.pick.picked_at,
      };
      writeCachedPick(window.localStorage, questionId, cached);
      setPick(cached);
      return;
    }
    setError(copy.errors.ALREADY_PICKED);
    return;
  }
  if (err instanceof ApiClientError && KNOWN_ERROR_COPY[err.code]) {
    setError(KNOWN_ERROR_COPY[err.code]!);
    return;
  }
  setError(copy.errors.generic);
}
