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
 * Design-diff audit: `flex-1 min-h-[70dvh]` (not just a fixed height) and no `rounded-xl` — the
 * mockup's own rounded corner (`.scr{border-radius:33px}`) is faking the PHYSICAL phone bezel
 * for the design doc's demo frame, not something a real deployment (where the browser viewport
 * IS the screen) should reproduce in CSS. `flex-1` fills whatever height `<main>`'s own `flex-1`
 * chain (`app/page.tsx`/`app/q/[slug]/page.tsx`, same posture) gives it on the real routes;
 * `min-h-[70dvh]` is the floor for contexts with no such ancestor (`/dev/ui`'s gallery demo,
 * which mounts this same component in a plain content-sized section) so the stage doesn't
 * collapse to its own bare content height there.
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
      className="bg-bg relative flex min-h-[70dvh] flex-1 flex-col overflow-hidden"
    >
      <DeckTopbar streakSlot={streakSlot} />

      {/* Design-diff audit: the "stage" (rails + card column) is its own wrapper, scoped to start
          right where the mockup's own `.stage` does — immediately AFTER `.topbar`, never behind
          it (`.rail-l`/`.rail-r` are `position:absolute` relative to `.stage`, not `.scr`, so the
          mockup's rail tint never reaches the topbar row at all). An earlier pass positioned the
          rails `absolute inset-y-0` against the WHOLE deck-stage container instead, so they
          technically extended behind the topbar too — at 14% opacity that read as neither a clean
          contiguous band starting right at the topbar's edge (the mockup) nor a visible bleed all
          the way up, just an inert dead zone at the very top. Scoping rails to this wrapper (which
          starts exactly where the topbar ends) fixes that. */}
      <div className="relative flex flex-1 flex-col overflow-hidden">
        {/* Side rails — the persistent tutorial (§2.5). Static chrome; the hint arrows that fade
            with experience live in SwipeBallot. */}
        <div
          aria-hidden="true"
          data-testid="rail-against"
          className="pointer-events-none absolute inset-y-0 left-0 flex w-9 font-mono text-[13px] tracking-[0.28em] uppercase opacity-70"
          style={{ background: 'linear-gradient(90deg, rgba(249,115,22,0.14), transparent)' }}
        >
          {leftRail}
        </div>
        <div
          aria-hidden="true"
          data-testid="rail-for"
          className="pointer-events-none absolute inset-y-0 right-0 flex w-9 justify-end font-mono text-[13px] tracking-[0.28em] uppercase opacity-70"
          style={{ background: 'linear-gradient(-90deg, rgba(59,130,246,0.14), transparent)' }}
        >
          {rightRail}
        </div>

        {/* The card column. `flex-1` (no `justify-center` at this level — the actual centering
            now happens one level down, inside `viewerSlot` itself, design-diff audit) passes
            real height down so `SwipeBallot`'s own wells row can pin to the true bottom of the
            stage instead of just trailing wherever the card happens to end (the mockup's own
            `.wells` sits flush against `.scr`'s bottom edge, `.stage{flex:1}` absorbing all the
            leftover space above it) — see `SwipeBallot.tsx`'s own note for the rest of this
            chain. No top padding here (the mockup's own `.stage` has none either — its card is
            centered purely by `.stage`'s own `align-items:center`, no extra inset on top of that)
            and only `pb-[17px]` at the bottom, matching the mockup's own `.wells{padding:0 14px
            12px}` bottom inset (12px × 1.4) — an earlier pass used a uniform `py-8` here, which
            padded the BOTTOM of the whole column on top of `.wells`'s own inset, pushing the wells
            row well short of the true bottom edge instead of flush against it. The under-card
            still peeks from behind so finishing today reveals tomorrow. */}
        <div className="relative z-10 mx-auto flex w-full max-w-sm flex-1 flex-col px-9 pb-[17px]">
          <div className="relative flex flex-1 flex-col justify-center">
            <UnderCard
              label={underLabel}
              className="absolute inset-x-3 -top-3 -z-10 scale-95 opacity-80"
            />
            {viewerSlot}
          </div>
        </div>
      </div>
    </div>
  );
}
