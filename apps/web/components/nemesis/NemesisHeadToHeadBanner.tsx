import type { VerdictOutcome } from './VerdictCard';

export interface NemesisHeadToHeadBannerProps {
  viewerHandle: string;
  opponentHandle: string;
  viewerScore: number;
  opponentScore: number;
  /** Same authoritative outcome `VerdictCard` renders for this entry — used only to color the
   * bar (never re-derived from the raw scores here), because a tiebreak week can have
   * `viewerScore === opponentScore` and still carry a real `won`/`lost` outcome (§SW10-T2's
   * "closed it out on the tiebreak" case, `copy.ts`'s `verdictWinnerLine`/`verdictLoserLine`
   * margin-0 branch) — recomputing from the scores alone would render that week as a false
   * dead-even split. */
  outcome: VerdictOutcome;
  className?: string;
}

interface SideClasses {
  half: string;
  bar: string;
}

/** win/loss/muted, spelled out as complete literal class strings (never `` `bg-${x}` `` template
 * concatenation) — Tailwind's compiler statically greps source files for whole class names, so a
 * dynamically-assembled `bg-${colors.viewer}/15` string is invisible to it and gets purged from
 * the production CSS, silently rendering unstyled. Each outcome's pair is written out in full
 * here instead. */
const WIN: SideClasses = { half: 'bg-win/15', bar: 'bg-win' };
const LOSS: SideClasses = { half: 'bg-loss/15', bar: 'bg-loss' };
const MUTED: SideClasses = { half: 'bg-muted/15', bar: 'bg-muted' };

/** Half-card and bar-segment colors, keyed off the authoritative outcome — never a static
 * "you're always green" mapping. `win`/`loss` (not `sideA`/`sideB`) on purpose: this banner
 * isn't a yes/no market side, it's "you" vs. "them" for a single settled week, the same
 * relationship `VerdictCard`'s own `Stamp variant={outcome}` already colors with `win`/`loss`
 * one row below — reusing that pairing keeps one color meaning ("green = the side that won this
 * week") instead of introducing a second, unrelated blue/orange vocabulary next to it. */
function outcomeColors(outcome: VerdictOutcome): { viewer: SideClasses; opponent: SideClasses } {
  if (outcome === 'won') return { viewer: WIN, opponent: LOSS };
  if (outcome === 'lost') return { viewer: LOSS, opponent: WIN };
  return { viewer: MUTED, opponent: MUTED };
}

/**
 * Head-to-head summary banner for a settled nemesis week (design-diff audit: the mockup's
 * Friday verdict exhibit, `docs/mockups/swipe-ux.html` "WEEK 30 · VERDICT" — its `.vsplit`
 * block: two big display-type name halves, a clipped "vbolt" score badge between them, and a
 * thick `.tug` proportional bar). The first cut of this component undersold that: mono-text
 * handles and a 1.5px hairline bar. This redesign matches the mockup's visual WEIGHT — large
 * `font-display` names, a diamond-clipped score badge, an 8px tug bar — while keeping the
 * mockup's *fabricated* stats out: no "N right"/"edge +11" subtitle under each name, because
 * `nemesisHistoryEntrySchema` carries only `my_score`/`their_score` (no per-day "right" counts,
 * no computed "edge" figure) — the same constraint `VerdictCard`'s own `scoreMargin` doc comment
 * already pins ("the prior 'edge' framing implied data ... that doesn't exist"). `VerdictCard`
 * still owns the day-by-day dot strip and the winner/loser narrative line; this only adds the
 * handle-vs-handle scoreline the mockup's exhibit pairs with it.
 *
 * Pure/presentational — mounted directly above the row's `VerdictCard` in `NemesisHistoryList`,
 * for every entry that gets one (i.e. not `cancelled`, per that file's `verdictFor()` convention).
 */
export function NemesisHeadToHeadBanner({
  viewerHandle,
  opponentHandle,
  viewerScore,
  opponentScore,
  outcome,
  className = '',
}: NemesisHeadToHeadBannerProps) {
  const total = viewerScore + opponentScore;
  // A week with zero combined score (every row voided) has nothing to proportion — split the
  // bar evenly rather than divide by zero.
  const viewerPct = total > 0 ? (viewerScore / total) * 100 : 50;
  const opponentPct = 100 - viewerPct;
  const colors = outcomeColors(outcome);

  return (
    <div dir="ltr" data-testid="head-to-head-banner" className={`space-y-2 ${className}`}>
      <div className="relative flex overflow-hidden rounded-lg">
        <div className={`flex min-w-0 flex-1 items-center px-3 py-3 pr-6 ${colors.viewer.half}`}>
          <span className="font-display min-w-0 truncate text-lg leading-none font-bold uppercase">
            {viewerHandle}
          </span>
        </div>
        <div
          aria-hidden="true"
          className="bg-paper text-ink absolute top-0 left-1/2 flex h-full w-12 -translate-x-1/2 items-center justify-center font-mono text-xs font-bold"
          style={{ clipPath: 'polygon(32% 0, 100% 0, 68% 100%, 0 100%)' }}
        >
          {viewerScore}–{opponentScore}
        </div>
        <div
          className={`flex min-w-0 flex-1 items-center justify-end px-3 py-3 pl-6 text-right ${colors.opponent.half}`}
        >
          <span className="font-display min-w-0 truncate text-lg leading-none font-bold uppercase">
            {opponentHandle}
          </span>
        </div>
      </div>
      <div
        role="img"
        aria-label={`Score split: ${viewerHandle} ${viewerScore}, ${opponentHandle} ${opponentScore}`}
        className="bg-surface flex h-2 w-full overflow-hidden rounded-full"
      >
        <span className={colors.viewer.bar} style={{ width: `${viewerPct}%` }} />
        <span className={colors.opponent.bar} style={{ width: `${opponentPct}%` }} />
      </div>
    </div>
  );
}
