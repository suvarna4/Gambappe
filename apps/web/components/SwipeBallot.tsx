'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { MarketSide, QuestionPublic } from '@receipts/core';
import {
  BallotCard,
  dragProgress,
  dragSide,
  FLING_MS,
  GUARDRAIL_KEYS,
  HAPTIC_ARM,
  HAPTIC_COMMIT,
  HAPTIC_UNDO,
  hintsHidden,
  impliedCents,
  isCommit,
  NUDGE_IDLE_MS,
  prefersReducedMotion,
  railsOpacity,
  sideAxisPair,
  stampScale,
  tintOpacity,
} from '@receipts/ui';
import { ballotCopy, copy } from '@/lib/copy';
import { formatEtClock } from '@/lib/format-et';
import type { CachedPick } from '@/lib/pick-storage';
import { ReceiptSlip } from './ReceiptSlip';

export interface SwipeBallotProps {
  question: QuestionPublic;
  /** DD-11/INV-9: viewer hasn't attested 18+ — commit pauses at the threshold for the on-card
   * attest confirm (§2.3.6) rather than submitting immediately. */
  ageGateRequired: boolean;
  /** Busy (a pick/undo is in flight): the card ignores input and the wells disable. */
  disabled?: boolean;
  /** Non-null → the receipt state (SW1-T3 enriches the slip). */
  pick: CachedPick | null;
  undoable: boolean;
  onPick: (side: MarketSide, ageAttested: boolean) => void;
  onUndo: () => void;
  /**
   * SW2-T4: the ballot arrived "pre-armed" from a notification/unfurl deep link (`?arm=1`).
   * Forces one idle nudge on mount and keeps the hint arrows visible regardless of the
   * learned-hand guardrail — a first-time visitor tapping a share card should always see the
   * gesture affordance. Never auto-picks anything (SW7-T2 owns the URL plumbing).
   */
  arm?: boolean;
}

/** Vibrate if the API exists; a no-op everywhere else (never gate behavior on it). */
function haptic(pattern: number | readonly number[]): void {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    navigator.vibrate(pattern as number | number[]);
  }
}

function readCount(key: string): number {
  if (typeof window === 'undefined') return 0;
  const n = Number(window.localStorage.getItem(key));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * SW1-T2 · The swipe-ballot gesture engine (swipe-ux-plan §2.3): drag → arm at the 36%
 * threshold → commit; early release springs back (no accidental pick); the tap wells and
 * `←`/`→` keys are the always-present accessible fallback (a swipe is never the only path).
 * The first pick's 18+ gate pauses the throw at the threshold for an on-card confirm (§2.3.6).
 *
 * The server stamps the entry price at receipt (§6.2) — commit calls `onPick` immediately, and
 * no animation ever delays that POST. `SwipeBallot` mounts into the deck shell's reserved
 * overlay slot (SW2-T1) over the viewer-free static `BallotCard` (INV-10). Guardrails fade with
 * experience (D-SW7); `prefers-reduced-motion` drops every transform (§2.3.8).
 */
export function SwipeBallot({
  question,
  ageGateRequired,
  disabled = false,
  pick,
  undoable,
  onPick,
  onUndo,
  arm = false,
}: SwipeBallotProps) {
  const [reducedMotion] = useState(() => prefersReducedMotion());
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [armed, setArmed] = useState(false);
  const [pendingAge, setPendingAge] = useState<MarketSide | null>(null);
  const [flingSide, setFlingSide] = useState<MarketSide | null>(null);
  const [nudge, setNudge] = useState(false);
  const [pickCount, setPickCount] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const cardRef = useRef<HTMLDivElement>(null);
  const startX = useRef(0);
  const armedRef = useRef(false);

  const yesProbability = question.yes_price ?? 0.5;
  const yesLabel = question.yes_label;
  const noLabel = question.no_label;
  const isOpen = question.status === 'open';

  // Guardrail counters (§2.8) — local, per device, approximate across devices (fine).
  useEffect(() => {
    setPickCount(readCount(GUARDRAIL_KEYS.picks));
  }, []);

  // SW7-T2: strip `?arm` from the URL after mount so a refresh or a re-share of this URL doesn't
  // re-arm (the nudge/hints have already been forced this mount). History-only — no navigation.
  useEffect(() => {
    if (!arm || typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has('arm')) return;
    url.searchParams.delete('arm');
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  }, [arm]);

  // Drives the receipt's undo countdown while the window is open (display only — the DELETE
  // re-verifies server-side, §6.2 step 3).
  useEffect(() => {
    if (!pick || !undoable) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [pick, undoable]);

  // Idle nudge: once per session, before the first-ever throw, on an actionable open question.
  // A pre-armed deep link (SW2-T4) forces the nudge on arrival and bypasses the once-per-session
  // and first-throw guards — the whole point is to teach the gesture to someone who just tapped
  // a share card, even if they've picked here before.
  useEffect(() => {
    if (reducedMotion || !isOpen || pick || pendingAge) return;
    if (typeof window === 'undefined') return;
    if (!arm) {
      if (window.localStorage.getItem(GUARDRAIL_KEYS.thrown)) return;
      if (window.sessionStorage.getItem(GUARDRAIL_KEYS.nudged)) return;
    }
    const delay = arm ? 350 : NUDGE_IDLE_MS;
    const id = window.setTimeout(() => {
      if (!arm && window.sessionStorage.getItem(GUARDRAIL_KEYS.nudged)) return;
      window.sessionStorage.setItem(GUARDRAIL_KEYS.nudged, '1');
      setNudge(true);
      window.setTimeout(() => setNudge(false), 5300);
    }, delay);
    return () => window.clearTimeout(id);
  }, [reducedMotion, isOpen, pick, pendingAge, arm]);

  const width = () => cardRef.current?.offsetWidth ?? 0;
  const progress = dragProgress(dx, width());
  const activeSide = dragging || flingSide ? (flingSide ?? dragSide(dx)) : null;

  const recordThrow = useCallback(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(GUARDRAIL_KEYS.thrown, '1');
    const next = readCount(GUARDRAIL_KEYS.picks) + 1;
    window.localStorage.setItem(GUARDRAIL_KEYS.picks, String(next));
    setPickCount(next);
  }, []);

  /** Fire the pick (or, on the first pick, pause for the age gate). Shared by swipe + wells + keys. */
  const submit = useCallback(
    (side: MarketSide) => {
      if (disabled) return;
      if (ageGateRequired) {
        setPendingAge(side);
        setDx(0);
        setArmed(false);
        armedRef.current = false;
        return;
      }
      haptic(HAPTIC_COMMIT);
      recordThrow();
      if (!reducedMotion) {
        setFlingSide(side);
        window.setTimeout(() => setFlingSide(null), FLING_MS);
      }
      setDx(0);
      setArmed(false);
      armedRef.current = false;
      onPick(side, false);
    },
    [ageGateRequired, disabled, onPick, recordThrow, reducedMotion],
  );

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || pick || pendingAge) return;
    setDragging(true);
    setNudge(false);
    startX.current = e.clientX;
    setDx(0);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    const nextDx = e.clientX - startX.current;
    setDx(nextDx);
    const p = dragProgress(nextDx, width());
    if (isCommit(p) && !armedRef.current) {
      armedRef.current = true;
      setArmed(true);
      haptic(HAPTIC_ARM);
    } else if (!isCommit(p) && armedRef.current) {
      armedRef.current = false;
      setArmed(false);
    }
  };

  const endDrag = () => {
    if (!dragging) return;
    setDragging(false);
    if (isCommit(dragProgress(dx, width()))) {
      submit(dragSide(dx));
    } else {
      setDx(0);
      setArmed(false);
      armedRef.current = false;
    }
  };

  const handleUndo = useCallback(() => {
    haptic(HAPTIC_UNDO);
    onUndo();
  }, [onUndo]);

  function confirmAge() {
    if (!pendingAge) return;
    const side = pendingAge;
    setPendingAge(null);
    haptic(HAPTIC_COMMIT);
    recordThrow();
    onPick(side, true);
  }

  // ---- Receipt state (SW1-T3). ----
  if (pick) {
    const sideLabel = pick.side === 'yes' ? yesLabel : noLabel;
    // Receipts over claims (§2.4): print the STAMPED entry price, not the drifting live one.
    const entryCents = impliedCents(pick.side, pick.yesPriceAtEntry ?? yesProbability);
    const secondsLeft = undoable
      ? Math.max(0, Math.ceil((Date.parse(pick.undoUntilIso) - nowMs) / 1000))
      : null;
    return (
      <div className="space-y-2" data-testid="viewer-strip-pick">
        <ReceiptSlip
          sideLabel={sideLabel}
          entryCents={entryCents}
          pickedAtLabel={`${formatEtClock(pick.pickedAtIso)} ET`}
          serial={`№ ${question.question_date ?? question.slug.slice(0, 10)}`}
          sealedNote={ballotCopy.crowdSealed(formatEtClock(question.lock_at))}
          secondsLeft={secondsLeft}
          onUndo={handleUndo}
          disabled={disabled}
          reducedMotion={reducedMotion}
        />
        <p className="text-muted px-1 font-mono text-xs">
          {copy.question.comeBackAt(formatEtClock(question.reveal_at))}
        </p>
      </div>
    );
  }

  // ---- Interactive open state. ----
  const flingTransform =
    flingSide && !reducedMotion
      ? `translate(${flingSide === 'yes' ? 140 : -140}%, -8%) rotate(${flingSide === 'yes' ? 26 : -26}deg)`
      : dragging && !reducedMotion
        ? `translate(${dx}px, ${dx * 0.25 * 0.25}px) rotate(${Math.max(-12, Math.min(12, dx * 0.09))}deg)`
        : undefined;

  const showPreview = progress > 0.04 || (reducedMotion && progress >= 0.6);
  const previewSide = dragSide(dx);
  const previewCents = impliedCents(previewSide, yesProbability);
  const previewLabel = previewSide === 'yes' ? yesLabel : noLabel;

  // SW2-T4: left/right arrows pick, matching the desktop hint — handled on the wells (interactive
  // elements, so jsx-a11y-clean) rather than the non-interactive card. Same meaning whichever
  // well has focus (D-SW9 axis: ← against, → for).
  const onWellKey = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      submit('yes');
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      submit('no');
    }
  };

  const wells = sideAxisPair(
    <button
      key="no"
      type="button"
      data-testid="pick-no"
      disabled={disabled}
      onClick={() => submit('no')}
      onKeyDown={onWellKey}
      className="border-side-b text-side-b min-h-12 flex-1 rounded-lg border-2 font-display text-sm font-bold tracking-wide uppercase disabled:opacity-50"
    >
      {ballotCopy.wellAgainstGlyph} {noLabel}
    </button>,
    <button
      key="yes"
      type="button"
      data-testid="pick-yes"
      disabled={disabled}
      onClick={() => submit('yes')}
      onKeyDown={onWellKey}
      className="border-side-a text-side-a min-h-12 flex-1 rounded-lg border-2 font-display text-sm font-bold tracking-wide uppercase disabled:opacity-50"
    >
      {yesLabel} {ballotCopy.wellForGlyph}
    </button>,
  );

  return (
    <div className="space-y-3" data-testid="swipe-ballot">
      <div className="relative">
        {/* World-tint wash (gesture-driven — lives in the interactive component, §2.5). */}
        {activeSide ? (
          <div
            aria-hidden="true"
            data-testid="ballot-tint"
            data-side={activeSide}
            className="pointer-events-none absolute -inset-6 rounded-3xl"
            style={{
              background:
                activeSide === 'yes'
                  ? 'radial-gradient(120% 90% at 85% 50%, rgba(59,130,246,0.42), transparent 62%)'
                  : 'radial-gradient(120% 90% at 15% 50%, rgba(249,115,22,0.42), transparent 62%)',
              opacity: flingSide ? 0.85 : tintOpacity(progress),
              transition: dragging ? 'none' : 'opacity 180ms',
            }}
          />
        ) : null}

        {/* The card is a pointer-drag surface with an accessible name; the two tap wells below
            are the keyboard/AT path (real buttons — Tab + Enter), so the card itself is not a
            focusable custom widget. SPEC-GAP(SW1-T2): the plan sketched arrow-keys-on-card, but
            standard buttons are a stronger, jsx-a11y-clean keyboard affordance than a focusable
            non-interactive div, so keyboard picking lives on the wells. Pointer handlers are not
            in jsx-a11y's flagged handler set, so a labelled group with them stays lint-clean. */}
        <div
          ref={cardRef}
          role="group"
          aria-label={ballotCopy.cardAriaLabel(question.headline, yesLabel, noLabel)}
          data-testid="ballot-card-interactive"
          data-armed={armed ? 'true' : 'false'}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className={`relative touch-none select-none ${nudge ? 'motion-safe:[animation:ballot-nudge_2.6s_ease-in-out_2]' : ''}`}
          style={{
            transform: flingTransform,
            transition: flingSide
              ? `transform ${FLING_MS}ms cubic-bezier(.3,.6,.4,1)`
              : dragging
                ? 'none'
                : 'transform 400ms cubic-bezier(.28,1.6,.5,1)',
            cursor: dragging ? 'grabbing' : 'grab',
          }}
        >
          <BallotCard
            eyebrow={question.kind.toUpperCase()}
            serial={`№ ${question.question_date ?? question.slug.slice(0, 10)}`}
            headline={question.headline}
            yesLabel={yesLabel}
            noLabel={noLabel}
            yesProbability={yesProbability}
            venue={`${question.venue.toUpperCase()} · LIVE`}
            lockLabel={`LOCKS ${formatEtClock(question.lock_at)}`}
            overlay={
              <>
                {showPreview ? (
                  <span
                    aria-hidden="true"
                    data-testid="stamp-preview"
                    className={`pointer-events-none absolute top-[42%] left-1/2 -rotate-6 rounded border-2 px-3 py-1 font-display text-lg font-bold uppercase ${previewSide === 'yes' ? 'border-side-a text-side-a' : 'border-side-b text-side-b'}`}
                    style={{
                      transform: `translate(-50%,-50%) rotate(-6deg) scale(${stampScale(progress)})`,
                      opacity: Math.min(1, progress),
                    }}
                  >
                    {previewLabel} @ {previewCents}¢
                  </span>
                ) : null}
                {pendingAge ? (
                  <div
                    data-testid="age-gate"
                    className="bg-paper/95 absolute inset-x-0 bottom-0 space-y-1 border-t px-4 py-3"
                  >
                    <p className="text-ink font-mono text-xs">{copy.question.ageGatePrompt}</p>
                    <div dir="ltr" className="flex gap-3">
                      <button
                        type="button"
                        data-testid="age-gate-cancel"
                        onClick={() => setPendingAge(null)}
                        className="text-muted min-h-11 flex-1 rounded border text-xs"
                      >
                        {copy.question.ageGateCancel}
                      </button>
                      <button
                        type="button"
                        data-testid="age-gate-confirm"
                        onClick={confirmAge}
                        className="bg-win text-ink min-h-11 flex-1 rounded text-xs font-semibold"
                      >
                        {copy.question.ageGateConfirm}
                      </button>
                    </div>
                  </div>
                ) : null}
              </>
            }
          />
        </div>

        {/* Hint arrows inside the stage bottom — fade out once the hand has learned (D-SW7); a
            pre-armed deep link (SW2-T4) keeps them for the first-time visitor. */}
        {arm || !hintsHidden(pickCount) ? (
          <div
            aria-hidden="true"
            data-testid="ballot-hints"
            className="text-muted mt-2 flex justify-between font-mono text-[11px] tracking-widest"
            style={{ opacity: arm ? 1 : railsOpacity(pickCount) }}
          >
            <span className="text-side-b">
              {ballotCopy.againstArrow} {noLabel}
            </span>
            <span className="text-side-a">
              {yesLabel} {ballotCopy.forArrow}
            </span>
          </div>
        ) : null}
      </div>

      {/* Tap wells — always present, never faded (a11y is permanent, D-SW7). */}
      <div dir="ltr" className="flex gap-2">
        {wells[0]}
        {wells[1]}
      </div>

      {/* SW2-T4: desktop keyboard affordance — the arrow keys pick from the wells. Shown only on
          fine-pointer (mouse/keyboard) devices; on touch it's noise. Decorative (the wells are
          the real controls), so aria-hidden. */}
      <p
        aria-hidden="true"
        data-testid="ballot-key-hint"
        className="text-muted mt-1 hidden text-center font-mono text-[10px] tracking-wide [@media(pointer:fine)]:block"
      >
        {ballotCopy.againstArrow} {noLabel} · {yesLabel} {ballotCopy.forArrow}
      </p>
    </div>
  );
}
