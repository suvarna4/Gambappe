'use client';

import { useCallback, useEffect, useState } from 'react';
import type { MarketSide, QuestionPeek, QuestionPublic } from '@receipts/core';
import { copy, shareCopy } from '@/lib/copy';
import { postAnalyticsEvent } from '@/lib/analytics-client';
import { DEFAULT_PICK_SOURCE, type PickInputSource } from '@/lib/pick-input-source';
import { formatClock } from '@/lib/format-et';
import { ApiClientError, fetchMe, placePick, undoPick } from '@/lib/pick-client';
import { canPick, canUndo, needsAgeGate } from '@/lib/pick-eligibility';
import {
  clearCachedPick,
  readCachedPick,
  writeCachedPick,
  type CachedPick,
} from '@/lib/pick-storage';
import { fetchCurrentDuo } from '@/lib/duo-client';
import { fetchTomorrowPeek } from '@/lib/tomorrow-peek-client';
import ShareSheet from './share/ShareSheet';
import { PickButtons } from './PickButtons';
import { QuestionThread } from './QuestionThread';
import { RevealSequence } from './RevealSequence';
import { SwipeBallot } from './SwipeBallot';

export interface ViewerStripProps {
  question: QuestionPublic;
  /**
   * SW1-T4: `swipe_ballot` flag (server-read, passed in). When on, the `open` state hydrates the
   * `SwipeBallot` gesture into this island instead of `PickButtons`. Its SSR output is viewer-free
   * (card + wells from question props, `pick=null`, age-gate defaulting on) so INV-10 holds; the
   * flag is not viewer data. Default `false` keeps the flag-off render byte-identical to today.
   */
  swipeBallot?: boolean;
  /** SW2-T4: the page arrived via a pre-armed deep link (`?arm=1`) — forces the gesture nudge +
   * hints for a first-time visitor. Forwarded to `SwipeBallot`; never auto-picks.
   *
   * Optional explicit override — `app/page.tsx` (already `force-dynamic`) still reads
   * `searchParams` server-side and passes this directly. `/q/[slug]/page.tsx` (ISR'd,
   * `revalidate = 30`) omits it: reading `searchParams` in a Server Component opts the whole
   * route out of static/ISR rendering in Next 15 regardless of the actual query string, which
   * would silently force every `/q/[slug]` request to hit the DB once `swipe_ballot` is on. When
   * omitted, this component detects `?arm=1` from `window.location` itself, client-side only —
   * SSR/hydration still render `arm=false` (byte-identical, same posture as `me`/`pick` above),
   * and a post-mount effect flips it, matching how those two already resolve after paint. */
  arm?: boolean;
  /**
   * SW10-T3(a) (wiring-gaps doc §4 SW10-T3): `duo_queue` flag (server-read, passed in — not
   * viewer data, same INV-10 posture as `swipeBallot` above). When on, this island fetches the
   * viewer's active duo client-side (post-hydration, mirroring the `/me` fetch below) and, once
   * the partner has picked today's question, forwards the sealed chip's data to `SwipeBallot`.
   * Default `false` keeps the flag-off render — and the extra fetch — byte-identical to before
   * this task.
   */
  duoQueue?: boolean;
  /**
   * WS18-T3 (journeys plan §5, D-J2): when this island is a card in the `/` stack deck, these wire
   * the deck through the existing pick machinery instead of forking it. All optional — omitted
   * (the `/q/[slug]` host and every other call site) keeps behavior byte-identical.
   *
   * `onSkip`/`footerSlot` are forwarded straight to `SwipeBallot` (the open swipe state). `onPicked`
   * fires once a pick commits, so `DeckQueue` can advance the deck (throw the card). A skip never
   * touches `onPicked` — it is not a pick.
   */
  onSkip?: () => void;
  footerSlot?: React.ReactNode;
  onPicked?: () => void;
}

type MeState =
  | { status: 'loading' }
  | { status: 'ready'; ageAttested: boolean; profileId: string }
  | { status: 'error' };

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
export function ViewerStrip({
  question,
  swipeBallot = false,
  arm: armProp,
  duoQueue = false,
  onSkip,
  footerSlot = null,
  onPicked,
}: ViewerStripProps) {
  const [me, setMe] = useState<MeState>({ status: 'loading' });
  const [pick, setPick] = useState<CachedPick | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [shareOpen, setShareOpen] = useState(false);
  const [arm, setArm] = useState(armProp ?? false);
  // SW10-T3(a): sealed partner chip data, non-null only once every gating condition (flag,
  // active duo, partner picked today) is confirmed — see the effect below and `duoQueue`'s doc
  // comment above.
  const [partnerLocked, setPartnerLocked] = useState<{ handle: string; pickedAtIso: string } | null>(
    null,
  );
  // Design-diff audit: the peeking next-day card (`docs/swipe-ux-plan.md` §2.5's under-card AC).
  // `null` until (and unless) `GET /questions/tomorrow` confirms a real one exists — see the
  // effect below for the fetch trigger and `SwipeBallot`'s doc comment for how this renders.
  const [tomorrowPeek, setTomorrowPeek] = useState<QuestionPeek | null>(null);

  useEffect(() => {
    // Only self-detect when the caller didn't already resolve `arm` server-side (see the prop's
    // doc comment) — an explicit `armProp` always wins.
    if (armProp !== undefined || typeof window === 'undefined') return;
    if (new URLSearchParams(window.location.search).get('arm') === '1') setArm(true);
  }, [armProp]);

  useEffect(() => {
    // `RevealSequence` (below) owns its own identity fetch (the reveal endpoint resolves the
    // viewer server-side) — skip the unrelated `/me` round trip once a question is revealed.
    if (question.status === 'revealed') return;
    let cancelled = false;
    fetchMe()
      .then(({ data }) => {
        if (!cancelled) {
          setMe({
            status: 'ready',
            ageAttested: data.profile.age_attested,
            profileId: data.profile.profile_id,
          });
        }
      })
      .catch(() => {
        if (!cancelled) setMe({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [question.status]);

  useEffect(() => {
    // SW10-T3(a) (wiring-gaps doc §4 SW10-T3): fetch the viewer's active duo only once flag +
    // question-state + identity are all confirmed — a claimed profile id is needed to tell the
    // partner apart from the viewer's own entry in `duo.partners`. Best-effort: any failure (not
    // claimed, not in a duo, network error) just leaves the chip unrendered, matching
    // `DuoHubClient`'s own best-effort `loadCurrent` posture. Also requires `swipeBallot` — the
    // chip only ever renders inside that branch below, so fetching without it would just be
    // wasted network traffic for every claimed viewer on every page view (fable review of
    // PR #90).
    if (!duoQueue || !swipeBallot || question.status !== 'open' || me.status !== 'ready') return;
    let cancelled = false;
    const viewerProfileId = me.profileId;
    fetchCurrentDuo()
      .then(({ data }) => {
        if (cancelled) return;
        if (!data.duo || !data.partner_pick_today?.picked || !data.partner_pick_today.picked_at) {
          return;
        }
        const partner =
          data.duo.partners.find((p) => p.profile_id !== viewerProfileId) ?? data.duo.partners[0];
        if (!partner) return;
        setPartnerLocked({ handle: partner.handle, pickedAtIso: data.partner_pick_today.picked_at });
      })
      .catch(() => {
        // Best-effort — see comment above.
      });
    return () => {
      cancelled = true;
    };
  }, [duoQueue, swipeBallot, question.status, me]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setPick(readCachedPick(window.localStorage, question.id));
  }, [question.id]);

  useEffect(() => {
    // Design-diff audit (`docs/swipe-ux-plan.md` §2.5's under-card AC): fetch tomorrow's peek
    // client-side, post-hydration — same pattern as the `duoQueue` effect above (`fetchCurrentDuo`)
    // and `fetchMe` below. Trigger is "a pick is on the board" (the committed-receipt state is the
    // only place this renders, `SwipeBallot`'s `pick` branch — see that file), not every visit to
    // an open question: the peek is decorative enrichment behind a state the viewer is already
    // looking at, not something worth a network round trip for every spectator who never picks.
    // Best-effort: a 404 (curation hasn't reached tomorrow yet — the common case most days) or any
    // other failure just leaves `tomorrowPeek` at its `null` default, which renders nothing extra
    // — `UnderCard`'s existing flat fallback (`copy.question.tomorrowTeaser`, via `DeckStage`)
    // keeps showing through unchanged, exactly the "degrade gracefully" requirement.
    if (!swipeBallot || question.status !== 'open' || !pick) return;
    let cancelled = false;
    fetchTomorrowPeek()
      .then(({ data }) => {
        if (!cancelled) setTomorrowPeek(data);
      })
      .catch(() => {
        // Best-effort — see comment above.
      });
    return () => {
      cancelled = true;
    };
  }, [swipeBallot, question.status, pick]);

  // Ticks the undo countdown; also doubles as the local expiry check driving `canUndo` below.
  // Pointless once revealed — `RevealSequence` (below) owns rendering then, and undo/pick UI
  // never shows again — so this would otherwise re-render every second forever for no reason.
  useEffect(() => {
    if (!pick || question.status === 'revealed') return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [pick, question.status]);

  const handlePick = useCallback(
    async (
      side: MarketSide,
      ageAttested: boolean,
      source: PickInputSource = DEFAULT_PICK_SOURCE,
    ) => {
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
          // SW1-T3: keep the stamped entry price so the receipt prints the receipts-over-claims
          // price, not the drifting live one (§2.4).
          yesPriceAtEntry: data.pick.yes_price_at_entry,
        };
        if (typeof window !== 'undefined')
          writeCachedPick(window.localStorage, question.id, cached);
        setPick(cached);
        // WS18-T3: a committed pick is a "throw" — let the stack deck (if this island is a card in
        // it) advance to the next card. No-op off the deck. Fires only on a real pick, never a skip.
        onPicked?.();
        // SW8-T3: fire-and-forget the input-method analytics (never awaited, never load-bearing).
        // Powers the PRD §10 swipe-share-of-picks / >40%-one-throw readout.
        postAnalyticsEvent('pick_created', { source });
        if (ageAttested) {
          setMe((prev) => (prev.status === 'ready' ? { ...prev, ageAttested: true } : prev));
        }
      } catch (err) {
        handlePickError(err, question.id, setPick, setError);
      } finally {
        setBusy(false);
      }
    },
    [question.id, onPicked],
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

  // SW1-T4: the swipe ballot owns the `open` state when the flag is on. It renders the card,
  // wells, tint, stamp preview, age gate, and receipt itself — so it replaces the loading
  // skeleton / PickButtons / pick-view branches below for this state. SSR output is viewer-free
  // (pick loads from localStorage post-hydration; age-gate defaults on until `/me` resolves), so
  // the byte-identical-HTML invariant (INV-10) is preserved. Reuses the same handlePick/handleUndo
  // and error slot as the button flow.
  if (swipeBallot && question.status === 'open') {
    return (
      <div className="space-y-2" data-testid="viewer-strip-swipe">
        <SwipeBallot
          question={question}
          ageGateRequired={me.status === 'ready' ? needsAgeGate(me.ageAttested) : true}
          disabled={busy}
          pick={pick}
          undoable={pick ? canUndo(pick, nowMs, question.lock_at) : false}
          onPick={handlePick}
          onUndo={handleUndo}
          arm={arm}
          partnerLocked={partnerLocked}
          tomorrowPeek={tomorrowPeek}
          onSkip={onSkip}
          footerSlot={footerSlot}
        />
        {error ? (
          <p className="text-loss text-xs" data-testid="viewer-strip-error">
            {error}
          </p>
        ) : null}
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
    // §10.5/WS8-T2: the receipt card only has a real win/loss/void/busted-streak result once
    // grading has happened — before that there's nothing worth sharing yet (a pre-reveal
    // "your pick" doesn't fit the receipt template's stamp). The `/api/cards/receipt/:pickId`
    // route re-derives the exact variant server-side from live pick/profile state (§10.5's
    // "busted-streak" SPEC-GAP note in `lib/og/entities.ts`) — this component just decides
    // WHEN to offer sharing, never which variant renders. `revealed` never reaches this branch
    // (the early return above hands that state to `RevealSequence`, which offers its own share
    // button off `viewer.pick` once grading is confirmed) — only `voided` still falls through
    // to this generic pick view.
    const settled = question.status === 'voided';
    return (
      <div className="space-y-2" data-testid="viewer-strip-pick">
        <p className="font-mono text-sm">
          {copy.question.yourPickLabel}: {sideLabel}
        </p>
        <p className="text-muted text-xs">
          {copy.question.comeBackAt(formatClock(question.reveal_at))}
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
        {settled ? (
          <>
            <button
              type="button"
              onClick={() => setShareOpen(true)}
              data-testid="share-receipt-button"
              className="bg-side-a min-h-11 rounded px-3 py-1.5 text-xs font-semibold text-white"
            >
              {shareCopy.shareButtonLabel}
            </button>
            <ShareSheet
              kind="receipt"
              targetId={pick.pickId}
              pagePath={`/q/${question.slug}`}
              title={question.headline}
              open={shareOpen}
              onOpenChange={setShareOpen}
            />
          </>
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
