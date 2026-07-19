import type { ReactNode } from 'react';
import type { QuestionPublic } from '@receipts/core';
import { CountdownTicker, CrowdBar, RevealHush, Stamp } from '@receipts/ui';
import { copy, hushCopy } from '@/lib/copy';
import { formatEtClock } from '@/lib/format-et';

/** The dark stage ground shared by every flag-on state (§2.5) — the deck's paper-on-dark world,
 * minus the open-state rails (those belong to the gesture, `DeckStage`). */
function Stage({ children }: { children: ReactNode }) {
  return (
    <div className="bg-bg flex min-h-[50dvh] flex-col items-stretch justify-center gap-4 rounded-xl px-6 py-8">
      {children}
    </div>
  );
}

function DeckHeadline({ question }: { question: QuestionPublic }) {
  return (
    <h1 className="font-display text-2xl leading-[1.03] font-bold uppercase">
      {question.headline}
    </h1>
  );
}

export interface DeckStatesProps {
  question: QuestionPublic;
  serverOffsetMs: number;
  viewerSlot?: ReactNode;
}

/**
 * SW2-T2 · The non-`open` question states rendered on the deck stage (swipe-ux-plan §2.5): the
 * flag-on counterpart of `QuestionStateView`'s ticket layout for {scheduled, locked, revealed,
 * voided}. Viewer-free (INV-10) — the crowd split shown here is the public post-lock snapshot
 * (§9.3 keeps it null while open, so this never leaks a live split); "your side vs. crowd" and
 * the reveal choreography arrive through `viewerSlot` (`ViewerStrip`). `open` is handled by
 * `DeckStage` (the interactive ballot), not here.
 */
export function DeckStates({ question, serverOffsetMs, viewerSlot }: DeckStatesProps) {
  return (
    <Stage>
      {question.status === 'scheduled' && (
        <div className="space-y-3" data-testid="question-scheduled">
          <DeckHeadline question={question} />
          <CountdownTicker
            targetIso={question.open_at}
            serverOffsetMs={serverOffsetMs}
            label={copy.question.opensLabel}
          />
          <p className="text-muted font-mono text-xs">{formatEtClock(question.open_at)}</p>
        </div>
      )}

      {question.status === 'locked' && (
        <RevealHush
          targetIso={question.reveal_at}
          serverOffsetMs={serverOffsetMs}
          // SW3-T1 (§2.6 F1): same room-count source QuestionStateView's flag-off locked state
          // uses — the crowd totals CrowdBar already renders just below.
          roomCountText={
            question.crowd ? hushCopy.roomCount(question.crowd.yes + question.crowd.no) : undefined
          }
          frozenLabel={hushCopy.frozenChip}
        >
          <div className="space-y-3" data-testid="question-locked">
            <DeckHeadline question={question} />
            {question.crowd ? (
              <CrowdBar
                yesCount={question.crowd.yes}
                noCount={question.crowd.no}
                yesLabel={question.yes_label}
                noLabel={question.no_label}
              />
            ) : null}
            <CountdownTicker
              targetIso={question.reveal_at}
              serverOffsetMs={serverOffsetMs}
              label={copy.question.revealInLabel}
            />
          </div>
        </RevealHush>
      )}

      {question.status === 'revealed' && (
        <div className="space-y-3" data-testid="question-revealed">
          <DeckHeadline question={question} />
          {question.crowd ? (
            <CrowdBar
              yesCount={question.crowd.yes}
              noCount={question.crowd.no}
              yesLabel={question.yes_label}
              noLabel={question.no_label}
              animated
            />
          ) : null}
          {/* Viewer-free outcome stamp (public once revealed) — the display-face, deck-styled
              counterpart of the ticket's outcome stamp. */}
          <p
            className="border-win text-win motion-safe:[animation:stamp-slam_450ms_ease-out_1] inline-block -rotate-3 rounded border-2 px-3 py-1 font-display text-lg font-bold tracking-wide uppercase"
            data-testid="reveal-outcome-stamp"
          >
            {question.outcome === 'yes' ? question.yes_label : question.no_label}
            <span aria-hidden="true"> ✓</span>
          </p>
        </div>
      )}

      {question.status === 'voided' && (
        <div className="space-y-3" data-testid="question-voided">
          <DeckHeadline question={question} />
          <Stamp variant="void" />
          <p className="text-muted text-sm">{copy.question.voidedExplainer}</p>
          {question.void_reason ? (
            <p className="text-muted font-mono text-xs">{question.void_reason}</p>
          ) : null}
        </div>
      )}

      {viewerSlot}
    </Stage>
  );
}
