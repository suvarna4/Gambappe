import type { VerdictOutcome } from './VerdictCard';

export interface NemesisHeadToHeadBannerProps {
  viewerHandle: string;
  opponentHandle: string;
  viewerScore: number;
  opponentScore: number;
  /** Same authoritative outcome `VerdictCard` renders for this entry — used only to color the
   * banner (never re-derived from the raw scores here), because a tiebreak week can have
   * `viewerScore === opponentScore` and still carry a real `won`/`lost` outcome (§SW10-T2's
   * "closed it out on the tiebreak" case, `copy.ts`'s `verdictWinnerLine`/`verdictLoserLine`
   * margin-0 branch) — recomputing from the scores alone would render that week as a false
   * dead-even split. */
  outcome: VerdictOutcome;
  className?: string;
}

interface SideVisual {
  half: string;
  name: string;
  bar: string;
}

/** Every visual role, spelled out as complete literal Tailwind class strings (never
 * `` `bg-${x}` `` template concatenation) — Tailwind's compiler statically greps source files
 * for whole class names, so a dynamically-assembled string is invisible to it and gets purged
 * from the production CSS, silently rendering unstyled. */
const SHINE_WIN: SideVisual = {
  half: 'bg-gradient-to-br from-win/35 via-win/10 to-transparent',
  name: 'text-win',
  bar: 'bg-win',
};
const SHINE_LOSS: SideVisual = {
  half: 'bg-gradient-to-bl from-win/35 via-win/10 to-transparent',
  name: 'text-win',
  bar: 'bg-win',
};
/** The losing side keeps its own loss-red family (so the split still reads red-vs-green at a
 * glance) but at reduced opacity — "the winner shines, the loser fades" (the mockup's own trick
 * for this exhibit: both halves share one gradient treatment, the loser dialed down via a flat
 * `opacity:.55` on that whole half — see swipe-ux.html's "Friday — the verdict" exhibit). */
const FADE: SideVisual = {
  half: 'bg-gradient-to-br from-loss/20 via-loss/5 to-transparent opacity-60',
  name: 'text-loss/80',
  bar: 'bg-loss',
};
const NEUTRAL: SideVisual = {
  half: 'bg-muted/10',
  name: 'text-ink',
  bar: 'bg-muted',
};

function outcomeVisuals(outcome: VerdictOutcome): { viewer: SideVisual; opponent: SideVisual } {
  if (outcome === 'won') return { viewer: SHINE_WIN, opponent: FADE };
  if (outcome === 'lost') return { viewer: FADE, opponent: SHINE_LOSS };
  return { viewer: NEUTRAL, opponent: NEUTRAL };
}

/**
 * Head-to-head summary banner for a settled nemesis week (design-diff audit: the mockup's
 * Friday verdict exhibit, `docs/mockups/swipe-ux.html` "WEEK 30 · VERDICT" — its `.vsplit`
 * block: two big display-type name halves and a clipped "vbolt" score badge between them).
 * Matches the mockup's actual color trick, not a flat red/green split: BOTH halves share one
 * rich, dark, saturated gradient treatment (`--yes-hot`-style "voltage" energy, not a pastel
 * tint), and the *loser's* half is simply dialed down via opacity ("the winner shines, the
 * loser fades") rather than switched to a different, quieter color family. The center badge
 * keeps the real score (`4–1`), matching this exact exhibit — the mockup's separate "assignment
 * day" exhibit uses a static "VS" there instead, but that's a different moment in the product
 * (the pairing announcement, before any score exists), not this one.
 *
 * Still real-data-only: the mockup's own subtitle text for this exhibit is "3 right · edge +11"
 * — a fabricated per-day/edge stat that doesn't exist on `nemesisHistoryEntrySchema`
 * (`my_score`/`their_score` only), so it stays out, matching `VerdictCard`'s own pinned
 * constraint (`copy.ts`'s `verdictWinnerLine`/`verdictLoserLine`, whose doc comment says the
 * same thing: "the prior 'edge' framing implied data ... that doesn't exist"). `VerdictCard`
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
  const visuals = outcomeVisuals(outcome);

  return (
    <div dir="ltr" data-testid="head-to-head-banner" className={`space-y-2 ${className}`}>
      <div className="bg-bg relative flex overflow-hidden rounded-lg">
        <div className={`flex min-w-0 flex-1 items-center px-3 py-3 pr-6 ${visuals.viewer.half}`}>
          <span
            className={`font-display min-w-0 truncate text-lg leading-none font-bold uppercase ${visuals.viewer.name}`}
          >
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
          className={`flex min-w-0 flex-1 items-center justify-end px-3 py-3 pl-6 text-right ${visuals.opponent.half}`}
        >
          <span
            className={`font-display min-w-0 truncate text-lg leading-none font-bold uppercase ${visuals.opponent.name}`}
          >
            {opponentHandle}
          </span>
        </div>
      </div>
      <div
        role="img"
        aria-label={`Score split: ${viewerHandle} ${viewerScore}, ${opponentHandle} ${opponentScore}`}
        className="bg-surface flex h-2 w-full overflow-hidden rounded-full"
      >
        <span className={visuals.viewer.bar} style={{ width: `${viewerPct}%` }} />
        <span className={visuals.opponent.bar} style={{ width: `${opponentPct}%` }} />
      </div>
    </div>
  );
}
