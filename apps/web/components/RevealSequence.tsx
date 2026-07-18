import { useEffect, useState } from 'react';
import type { QuestionPublic, RevealPayload } from '@receipts/core';
import { Stamp, StreakFlame, prefersReducedMotion } from '@receipts/ui';
import { copy } from '@/lib/copy';
import { ApiClientError, fetchReveal } from '@/lib/pick-client';

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
const COUNT_UP_MS = 500;

function useCountUp(target: number, animate: boolean): number {
  const [value, setValue] = useState(animate ? 0 : target);

  useEffect(() => {
    if (!animate) {
      setValue(target);
      return;
    }
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

  return value;
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

  useEffect(() => {
    let cancelled = false;
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
        if (err instanceof ApiClientError && err.code === 'REVEAL_NOT_READY') {
          // Defensive only — `question.status === 'revealed'` already means the raw row
          // flipped (§6.5 publication rule); a 423 here would mean replication lag, not a
          // real not-yet-revealed state. One retry, then give up quietly.
          setTimeout(load, 1000);
          return;
        }
        setPhase('unavailable');
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [question.slug, reducedMotion]);

  const animateNumbers = play && !reducedMotion;
  const streakDisplay = useCountUp(payload?.viewer?.streak.current ?? 0, animateNumbers);
  const percentileDisplay = useCountUp(payload?.viewer?.percentile ?? 0, animateNumbers);

  if (phase === 'loading') {
    // Reserved slot (matches `ViewerStrip`'s own loading skeleton) — identical for every
    // visitor regardless of identity, satisfying INV-10 during SSR/hydration.
    return <div className="min-h-11" data-testid="reveal-sequence-loading" aria-hidden="true" />;
  }

  if (phase === 'unavailable') return null;

  if (phase === 'no-pick') {
    return (
      <p className="text-muted text-sm" data-testid="reveal-sequence-no-pick">
        {copy.question.revealedNoPickLabel}
      </p>
    );
  }

  const viewer = payload!.viewer!;
  const flipClass = play ? 'motion-safe:[animation:result-flip_350ms_ease-out_1]' : '';

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
    </div>
  );
}
