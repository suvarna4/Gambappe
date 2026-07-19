import { useEffect, useState } from 'react';
import { topPercentDisplay, type QuestionPublic, type RevealPayload } from '@receipts/core';
import { OBITUARY_MIN_STREAK, Stamp, StreakFlame, prefersReducedMotion } from '@receipts/ui';
import { buildObituaryFacts, copy, shareCopy } from '@/lib/copy';
import { formatShortDate } from '@/lib/format-et';
import { ApiClientError, fetchReveal } from '@/lib/pick-client';
import { ObituaryCard } from './ObituaryCard';
import ShareSheet from './share/ShareSheet';

export interface RevealSequenceProps {
  question: QuestionPublic;
}

type Phase = 'loading' | 'unavailable' | 'no-pick' | 'result';

/**
 * Roughly how long the server-rendered half of the §10.3 choreography (`QuestionStateView`'s
 * `revealed` branch: the outcome stamp-slam + crowd-bar-fill, pure CSS) takes to finish —
 * staggers this stage to start after it so the two halves read as one sequence instead of
 * racing. Best-effort only: if the reveal fetch is slower than this, `load` below starts as
 * soon as it resolves instead of waiting further — the ≤2s AC targets animation pacing, not
 * network latency.
 */
const STAGE_STAGGER_MS = 650;
/** "…your result flip → streak/percentile count-up": the numbers start ticking a beat after
 * the flip lands, rather than racing it (both were originally gated on the same `play` flag). */
const FLIP_TO_COUNT_UP_MS = 300;
const COUNT_UP_MS = 500;
/** `REVEAL_NOT_READY` past this many attempts stops retrying (§10.2's stampede-avoidance intent
 * for this endpoint applies here too — a fixed poll must not run forever): a question a client
 * saw as `revealed` can still flip to `voided` afterward via the admin post-reveal void path
 * (§6.5/§15.3, within `REGRADE_WINDOW_H`), which 423s this endpoint permanently, not transiently. */
const MAX_REVEAL_RETRIES = 3;

function useCountUp(target: number, animate: boolean): number {
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (!animate) return; // caller renders `target` directly below — no state round trip needed
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / COUNT_UP_MS);
      setValue(Math.round(target * progress));
      if (progress < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, animate]);

  return animate ? value : target;
}

/**
 * The client half of the §10.3 reveal moment: "your result flip → streak/percentile count-up."
 * The other half (outcome stamp slam, crowd bar fill) is pure CSS on `QuestionStateView`'s
 * viewer-free `revealed` branch — this half is inherently viewer-specific (a network round trip
 * for THIS profile's pick), so it must live in the client island (INV-10). Mounted by
 * `ViewerStrip` in place of its usual pick-state branches once `question.status === 'revealed'`.
 *
 * Deliberately NOT its own `'use client'` module: `ViewerStrip` (which already is one) is the
 * only caller, so this rides the same client bundle rather than becoming a second, redundant
 * RSC client-reference boundary — an extra boundary here was observed to make the flight
 * payload's chunk numbering vary between two otherwise-identical requests, which broke INV-10's
 * byte-identical-HTML assertion despite the rendered DOM being unaffected.
 */
export function RevealSequence({ question }: RevealSequenceProps) {
  const [reducedMotion] = useState(() => prefersReducedMotion());
  const [phase, setPhase] = useState<Phase>('loading');
  const [payload, setPayload] = useState<RevealPayload | null>(null);
  const [play, setPlay] = useState(false);
  const [countUp, setCountUp] = useState(false);
  // §10.5/WS8-T2: the receipt card only has a real win/loss/void/busted-streak result once
  // this phase is reached (`viewer.pick` exists and is graded) — this is the only place a
  // revealed question's share affordance can live now that `RevealSequence` (WS7-T3) owns
  // rendering the whole `revealed` state instead of `ViewerStrip`'s old generic pick view.
  const [shareOpen, setShareOpen] = useState(false);
  // SW9-T2 (obituary-handoff §3.3(1)): "Bury it" is a client-side-only dismiss for the rest of
  // this mount — no backend persistence (the design doc is explicit: the graveyard already
  // derives from history, so every dead run is "archived to the shelf" automatically; burying
  // is acknowledging the funeral, not filing it). Revisiting/remounting shows it again.
  const [buried, setBuried] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let retries = 0;
    const startedAt = Date.now();

    const load = async () => {
      try {
        const { data } = await fetchReveal(question.slug);
        if (cancelled) return;
        if (!reducedMotion) {
          const wait = STAGE_STAGGER_MS - (Date.now() - startedAt);
          if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
          if (cancelled) return;
        }
        setPayload(data);
        setPhase(data.viewer ? 'result' : 'no-pick');
        setPlay(true);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiClientError && err.code === 'UNAUTHENTICATED') {
          // No ghost/claimed cookie at all — nothing personal to show, same as "didn't pick".
          setPhase('no-pick');
          return;
        }
        if (err instanceof ApiClientError && err.code === 'REVEAL_NOT_READY' && retries < MAX_REVEAL_RETRIES) {
          // Defensive only — `question.status === 'revealed'` already means the raw row
          // flipped (§6.5 publication rule); a 423 here would mean replication lag, not a real
          // not-yet-revealed state. Bounded: a question CAN 423 permanently post-reveal (an
          // admin post-reveal void, §6.5/§15.3) — this must give up, not poll forever.
          retries += 1;
          retryTimer = setTimeout(load, 1000);
          return;
        }
        setPhase('unavailable');
      }
    };
    load();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [question.slug, reducedMotion]);

  // "…your result flip → streak/percentile count-up": starts a beat after the flip lands
  // instead of racing it.
  useEffect(() => {
    if (!play || reducedMotion) return;
    const id = setTimeout(() => setCountUp(true), FLIP_TO_COUNT_UP_MS);
    return () => clearTimeout(id);
  }, [play, reducedMotion]);

  const animateNumbers = countUp && !reducedMotion;
  const streakDisplay = useCountUp(payload?.viewer?.streak.current ?? 0, animateNumbers);
  const percentileTopPct =
    payload?.viewer?.percentile != null ? topPercentDisplay(payload.viewer.percentile) : 0;
  const percentileDisplay = useCountUp(percentileTopPct, animateNumbers);

  if (phase === 'loading') {
    // Reserved slot (matches `ViewerStrip`'s own loading skeleton) — identical for every
    // visitor regardless of identity, satisfying INV-10 during SSR/hydration.
    return <div className="min-h-11" data-testid="reveal-sequence-loading" aria-hidden="true" />;
  }

  if (phase === 'unavailable') {
    // Keeps the reserved slot rather than collapsing to nothing (no layout shift) — this is a
    // quiet degrade (network error, or retries exhausted on a permanently-423ing question), not
    // a page-breaking failure.
    return <div className="min-h-11" data-testid="reveal-sequence-unavailable" aria-hidden="true" />;
  }

  if (phase === 'no-pick') {
    return (
      <p className="text-muted text-sm" data-testid="reveal-sequence-no-pick">
        {copy.question.revealedNoPickLabel}
      </p>
    );
  }

  const viewer = payload!.viewer!;
  const flipClass = play ? 'motion-safe:[animation:result-flip_350ms_ease-out_1]' : '';

  // SW9-T2 (obituary-handoff §2, §3.2): the wake. `broken_run` is non-null exactly at the
  // viewer's first reveal after their participation streak died (server-mechanical condition,
  // §3.2); `OBITUARY_MIN_STREAK` is the client-side presentation threshold (§3.2 — the contract
  // itself carries no length floor). Below it, or when null, the normal share button renders
  // completely unchanged (explicit AC).
  const brokenRun = viewer.streak.broken_run;
  const showObituary = !buried && brokenRun !== null && brokenRun.length >= OBITUARY_MIN_STREAK;
  const deathPick = brokenRun?.last_pick ?? null;

  return (
    <div className="space-y-2" data-testid="reveal-sequence-result">
      <div className={`flex items-center gap-2 ${flipClass}`}>
        <Stamp variant={viewer.result} />
        {viewer.badges.includes('called_it') ? <Stamp variant="called_it" /> : null}
      </div>
      {viewer.percentile !== null ? (
        <p className="font-mono text-xs" data-testid="reveal-sequence-percentile">
          {copy.question.percentileLabel(percentileDisplay)}
        </p>
      ) : null}
      <div className="flex items-center gap-2" data-testid="reveal-sequence-streak">
        <StreakFlame count={streakDisplay} frozen={viewer.streak.freeze_used} />
        {viewer.streak.freeze_used ? (
          <span className="text-muted text-xs">{copy.question.freezeUsedNote}</span>
        ) : null}
      </div>
      {showObituary && brokenRun ? (
        <ObituaryCard
          days={brokenRun.length}
          startLabel={formatShortDate(brokenRun.started_on)}
          endLabel={formatShortDate(brokenRun.ended_on)}
          facts={buildObituaryFacts(brokenRun.freezes_survived, brokenRun.longest_odds_cents)}
          sideLabel={deathPick?.side_label}
          entryCents={deathPick?.entry_cents}
          onBury={() => setBuried(true)}
          // §3.2: `last_pick` can be null (unresolvable) — the share action isn't meaningfully
          // wireable then, so the handler (and with it `ObituaryCard`'s share button, via its
          // own `interactive = Boolean(onBury || onShare)` pattern) is omitted entirely rather
          // than opening a sheet with nothing real to target.
          onShare={deathPick ? () => setShareOpen(true) : undefined}
        />
      ) : (
        <button
          type="button"
          onClick={() => setShareOpen(true)}
          data-testid="share-receipt-button"
          className="bg-side-a min-h-11 rounded px-3 py-1.5 text-xs font-semibold text-white"
        >
          {shareCopy.shareButtonLabel}
        </button>
      )}
      <ShareSheet
        kind="receipt"
        // The obituary's share targets the DEATH pick, not this reveal's own pick — SW9-T3 made
        // that pick's canonical receipt card the tombstone, and `question_slug` in the contract
        // exists specifically so this link lands on that page (§4 SW9-T2 entry).
        targetId={showObituary && deathPick ? deathPick.pick_id : viewer.pick.id}
        pagePath={showObituary && deathPick ? `/q/${deathPick.question_slug}` : `/q/${question.slug}`}
        title={question.headline}
        open={shareOpen}
        onOpenChange={setShareOpen}
      />
    </div>
  );
}
