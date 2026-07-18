import type { CSSProperties } from 'react';
import { crowdSplit } from '../format.js';

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
}

/** §10.3/§10.4 CrowdBar: the crowd split, revealed at lock. Labels always ship with the color. */
export function CrowdBar({
  yesCount,
  noCount,
  yesLabel,
  noLabel,
  className = '',
  animated = false,
}: CrowdBarProps) {
  const { yesPct, noPct } = crowdSplit(yesCount, noCount);
  const fillClass = animated ? 'motion-safe:[animation:crowd-fill_500ms_ease-out_200ms_1_both]' : '';
  return (
    <div className={className}>
      <div className="text-muted mb-1 flex justify-between text-xs font-medium uppercase">
        <span className="text-side-a">
          {yesLabel} {yesPct}%
        </span>
        <span className="text-side-b">
          {noLabel} {noPct}%
        </span>
      </div>
      <div
        role="img"
        aria-label={`Crowd split: ${yesLabel} ${yesPct}%, ${noLabel} ${noPct}%`}
        className="flex h-3 w-full overflow-hidden rounded-full"
      >
        <div
          className={`bg-side-a h-full ${fillClass}`}
          style={
            (animated
              ? { width: `${yesPct}%`, '--crowd-fill-target': `${yesPct}%` }
              : { width: `${yesPct}%` }) as AnimatableStyle
          }
        />
        <div
          className={`bg-side-b h-full ${fillClass}`}
          style={
            (animated
              ? { width: `${noPct}%`, '--crowd-fill-target': `${noPct}%` }
              : { width: `${noPct}%` }) as AnimatableStyle
          }
        />
      </div>
    </div>
  );
}
