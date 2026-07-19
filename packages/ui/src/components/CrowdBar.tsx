import type { CSSProperties } from 'react';
import { crowdSplit } from '../format.js';
import { sideAxisPair } from '../side-axis.js';

/** Widens `style`'s type to accept the `--crowd-fill-target` custom property the animation
 * keyframe (`apps/web/app/globals.css`) reads from — React's `CSSProperties` has no index
 * signature for arbitrary custom properties otherwise. */
type AnimatableStyle = CSSProperties & { '--crowd-fill-target'?: string };

export interface CrowdBarProps {
  yesCount: number;
  noCount: number;
  yesLabel: string;
  noLabel: string;
  className?: string;
  /** WS7-T3 reveal-moment "crowd bar fill" (§10.3) — opt-in; see `Stamp`'s `animated` doc for
   * why this defaults to static and how reduced motion is honored. */
  animated?: boolean;
  /** Unlike `PriceTag` (always on paper), CrowdBar renders on both the dark deck stage
   * (`DeckStates`, `/dev/ui` gallery) and inside paper `TicketCard`s (`QuestionStateView`,
   * `PlacementClient`) — the bright `text-side-a`/`text-side-b` label colors clear AA on the
   * dark stage (~5.4:1 / ~7:1) but fail badly on paper (~3.3:1 / ~2.5:1, same class of bug
   * SW8-T1 fixed everywhere else). Pass `surface="paper"` at paper call sites for the same
   * darkened on-paper inks `PriceTag` uses; segment fills (not text) are unaffected either way. */
  surface?: 'dark' | 'paper';
}

/**
 * §10.3/§10.4 CrowdBar: the crowd split, revealed at lock. Labels always ship with the color.
 *
 * Axis order (D-SW9, swipe plan §2.2): NO on the left, YES on the right — both the label row
 * and the bar segments — with `dir="ltr"` so RTL locales don't mirror gesture space. The bar's
 * `justify-between` is what makes the animated YES fill RIGHT-anchored: the NO segment is
 * flush left and grows rightward from the left edge, while the YES segment stays pinned to the
 * container's right edge and grows leftward as the shared `crowd-fill` keyframe animates its
 * width — no second keyframe needed. At rest the two widths always sum to 100% (`crowdSplit`),
 * so the static layout is identical with or without the animation.
 */
export function CrowdBar({
  yesCount,
  noCount,
  yesLabel,
  noLabel,
  className = '',
  animated = false,
  surface = 'dark',
}: CrowdBarProps) {
  const { yesPct, noPct } = crowdSplit(yesCount, noCount);
  const fillClass = animated
    ? 'motion-safe:[animation:crowd-fill_500ms_ease-out_200ms_1_both]'
    : '';
  const segmentStyle = (pct: number): AnimatableStyle =>
    (animated
      ? { width: `${pct}%`, '--crowd-fill-target': `${pct}%` }
      : { width: `${pct}%` }) as AnimatableStyle;
  const noLabelClass = surface === 'paper' ? 'text-[#b34d0a]' : 'text-side-b';
  const yesLabelClass = surface === 'paper' ? 'text-[#1d4fa8]' : 'text-side-a';
  return (
    <div className={className}>
      <div dir="ltr" className="text-muted mb-1 flex justify-between text-xs font-medium uppercase">
        {sideAxisPair(
          <span key="no" data-side="no" className={noLabelClass}>
            {noLabel} {noPct}%
          </span>,
          <span key="yes" data-side="yes" className={yesLabelClass}>
            {yesLabel} {yesPct}%
          </span>,
        )}
      </div>
      <div
        dir="ltr"
        role="img"
        aria-label={`Crowd split: ${noLabel} ${noPct}%, ${yesLabel} ${yesPct}%`}
        className="flex h-3 w-full justify-between overflow-hidden rounded-full"
      >
        {sideAxisPair(
          <div
            key="no"
            data-side="no"
            className={`bg-side-b h-full ${fillClass}`}
            style={segmentStyle(noPct)}
          />,
          <div
            key="yes"
            data-side="yes"
            className={`bg-side-a h-full ${fillClass}`}
            style={segmentStyle(yesPct)}
          />,
        )}
      </div>
    </div>
  );
}
