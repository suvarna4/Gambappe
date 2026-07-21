import type { ReactNode } from 'react';
import type { QuestionPublic } from '@receipts/core';
import { sideAxisPair, UnderCard } from '@receipts/ui';
import { ballotCopy } from '@/lib/copy';
import { DeckTopbar } from './DeckTopbar';

export interface DeckStageProps {
  question: QuestionPublic;
  /** The hydrating viewer island (`ViewerStrip` → `SwipeBallot`), placed in the card position. */
  viewerSlot: ReactNode;
  /** `StreakBadge`, threaded into `DeckTopbar` — see that component's header. */
  streakSlot?: ReactNode;
  /**
   * Flat fallback label for the peek card under the deck (tomorrow's appointment) — always the
   * static `copy.question.tomorrowTeaser` banner (viewer-free, INV-10). Design-diff audit: once
   * a pick is committed, `SwipeBallot`'s own `pick` branch (client-side, post-hydration) renders
   * a SECOND, real-data `UnderCard` directly behind its printed `ReceiptSlip` when
   * `GET /questions/tomorrow` confirms one exists — see that file's `tomorrowPeek` prop. That one
   * paints in front of (visually replaces) this static one at the same position when it renders;
   * this prop/element deliberately stays untouched so every OTHER open-state render (pre-pick,
   * or the flag-off ticket path entirely) is unaffected and every existing snapshot for those
   * states holds.
   */
  underLabel?: string;
}

/**
 * SW2-T1 · The full-screen deck stage (swipe-ux-plan §2.5): a dark stage that fills the viewport,
 * side rails in each side's color, and the ballot in the middle. Viewer-free and server-rendered
 * (INV-10) — it renders only the static chrome and slots the client viewer island into the card
 * position, so its HTML is identical for every visitor. The interactive ballot, tint, stamp
 * preview, hints and receipt all live in `SwipeBallot` (which `ViewerStrip` hydrates into the
 * slot); the stage supplies the frame.
 *
 * Rails obey the side-axis rule (§2.2, D-SW9): the against side is the left rail, the for side the
 * right, built with `sideAxisPair` and pinned `dir="ltr"`.
 *
 * Design-diff audit: `flex-1` (not a fixed `min-h-[70dvh]`) and no `rounded-xl` — the mockup's
 * own rounded corner (`.scr{border-radius:33px}`) is faking the PHYSICAL phone bezel for the
 * design doc's demo frame, not something a real deployment (where the browser viewport IS the
 * screen) should reproduce in CSS. `flex-1` fills whatever height `<main>`'s own `flex-1` chain
 * (`app/page.tsx`/`app/q/[slug]/page.tsx`, same posture) gives it, growing to the real viewport
 * when content is shorter rather than guessing a fixed vh fraction.
 */
export function DeckStage({ question, viewerSlot, underLabel, streakSlot }: DeckStageProps) {
  const [leftRail, rightRail] = sideAxisPair(
    <div
      key="no"
      className="text-side-b flex items-center justify-center"
      style={{ writingMode: 'vertical-rl' }}
    >
      {ballotCopy.againstArrow} {question.no_label}
    </div>,
    <div
      key="yes"
      className="text-side-a flex items-center justify-center"
      style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
    >
      {ballotCopy.forArrow} {question.yes_label}
    </div>,
  );

  return (
    <div
      data-testid="deck-stage"
      dir="ltr"
      className="bg-bg relative flex flex-1 flex-col overflow-hidden"
    >
      <DeckTopbar streakSlot={streakSlot} />

      {/* Side rails — the persistent tutorial (§2.5). Static chrome; the hint arrows that fade
          with experience live in SwipeBallot. */}
      <div
        aria-hidden="true"
        data-testid="rail-against"
        className="pointer-events-none absolute inset-y-0 left-0 flex w-7 font-mono text-[9px] tracking-[0.28em] uppercase opacity-70"
        style={{ background: 'linear-gradient(90deg, rgba(249,115,22,0.14), transparent)' }}
      >
        {leftRail}
      </div>
      <div
        aria-hidden="true"
        data-testid="rail-for"
        className="pointer-events-none absolute inset-y-0 right-0 flex w-7 justify-end font-mono text-[9px] tracking-[0.28em] uppercase opacity-70"
        style={{ background: 'linear-gradient(-90deg, rgba(59,130,246,0.14), transparent)' }}
      >
        {rightRail}
      </div>

      {/* The card column. The under-card peeks from behind so finishing today reveals tomorrow.
          Design-diff audit: `flex flex-1 flex-col justify-center` (not a plain shrink-wrapped
          `relative`) lets `viewerSlot`'s interactive card (`SwipeBallot`'s own `flex-1` root)
          actually stretch to fill the available height — matching the mockup's tall "poster"
          card proportions (`.deck{height:300px}` inside a 250px-wide screen, `NemesisAssignmentCard`'s
          header has the full "interpret proportions, not literal pixels" rationale) instead of
          shrinking to fit its own content. `justify-center` is a no-op for that stretching child
          (flex-grow:1 claims all available space, leaving nothing to center) but keeps every OTHER
          `viewerSlot` shape this wraps — the brief pre-hydration loading skeleton, the printed
          receipt once a pick lands — vertically centered exactly as before this change. */}
      <div className="relative z-10 mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-9 py-8">
        <div className="relative flex flex-1 flex-col justify-center">
          <UnderCard
            label={underLabel}
            className="absolute inset-x-3 -top-3 -z-10 scale-95 opacity-80"
          />
          {viewerSlot}
        </div>
      </div>
    </div>
  );
}
