import { formatShortDate } from '@/lib/format-et';
import type { VerdictOutcome } from './VerdictCard';

export interface NemesisHeadToHeadBannerProps {
  viewerHandle: string;
  opponentHandle: string;
  viewerScore: number;
  opponentScore: number;
  /** The settled pairing's `week_start` (`YYYY-MM-DD`) — when present, renders a "Week of
   * {date} / Verdict" eyebrow above the split, the same topbar treatment
   * `NemesisAssignmentCard` uses for its "Week of {date} / Assignment day" row (one eyebrow
   * convention for both nemesis-week split moments). Optional so existing callers that don't
   * have a promoted entry in hand (`NemesisHistoryList`'s per-row banners, which already print
   * their own inline "week of ..." line beneath the row) keep rendering without it.  */
  weekStart?: string;
  /** Same authoritative outcome `VerdictCard` renders for this entry — used only to decide
   * which side dims (never re-derived from the raw scores here), because a tiebreak week can
   * have `viewerScore === opponentScore` and still carry a real `won`/`lost` outcome (§SW10-T2's
   * "closed it out on the tiebreak" case, `copy.ts`'s `verdictWinnerLine`/`verdictLoserLine`
   * margin-0 branch) — recomputing from the scores alone would render that week as a false
   * dead-even split. */
  outcome: VerdictOutcome;
  className?: string;
}

interface SideVisual {
  half: string;
  bar: string;
}

/** Fixed by POSITION, not by outcome — this is the mockup's actual scheme for this exhibit
 * (`docs/mockups/swipe-ux.html`'s `.vsplit .a`/`.vsplit .b`: a dark navy gradient + bright
 * `--yes-hot` blue on the left, a dark maroon gradient + bright `--no-hot` orange on the right,
 * same left/right pairing regardless of who's who). Reusing this app's own `side-a`/`side-b`
 * tokens (already `#3B82F6`/`#F97316`, functionally the same "voltage" blue/orange the mockup's
 * custom `--yes-hot`/`--no-hot` values approximate) rather than inventing a third color pair —
 * one match instead of a near-miss. Complete literal Tailwind class strings throughout (never
 * `` `bg-${x}` `` template concatenation): Tailwind's compiler statically greps source files for
 * whole class names, so a dynamically-assembled string is invisible to it and gets purged from
 * the production CSS, silently rendering unstyled. */
const VIEWER_HALF: SideVisual = {
  half: 'bg-gradient-to-br from-side-a/45 via-side-a/15 to-transparent text-side-a',
  bar: 'bg-side-a',
};
const OPPONENT_HALF: SideVisual = {
  half: 'bg-gradient-to-bl from-side-b/45 via-side-b/15 to-transparent text-side-b',
  bar: 'bg-side-b',
};

/** Which side dims — the ONLY outcome-driven visual in this banner. The mockup's own trick:
 * both halves keep their fixed blue/orange treatment; the *loser's* whole half (background AND
 * text together) is simply dialed down via a flat `opacity:.55` — "the winner shines, the loser
 * fades" — rather than either side switching color families. A draw dims neither. */
function loserOpacity(outcome: VerdictOutcome): { viewer: string; opponent: string } {
  if (outcome === 'won') return { viewer: '', opponent: 'opacity-[0.55]' };
  if (outcome === 'lost') return { viewer: 'opacity-[0.55]', opponent: '' };
  return { viewer: '', opponent: '' };
}

/**
 * Head-to-head summary banner for a settled nemesis week (design-diff audit: the mockup's
 * Friday verdict exhibit, `docs/mockups/swipe-ux.html` "WEEK 30 · VERDICT" — its `.vsplit`
 * block: two big display-type name halves and a clipped "vbolt" score badge between them, a
 * `.tug` bar below). Matches the mockup's actual color scheme, not a red/green win/loss split:
 * fixed dark navy/blue (viewer, left) and dark maroon/orange (opponent, right) gradients — the
 * SAME pairing regardless of who won — with only the loser's half dimmed via opacity. The
 * `.tug` bar below keeps the same fixed blue/orange pairing too (the mockup's own bar never
 * changes color by winner either, `.tug .ty`/`.tug .tn` are plain fixed yes/no colors). The
 * center badge keeps the real score (`4–1`), matching this exact exhibit, in the same bold
 * `font-display` face `NemesisAssignmentCard`'s "VS" badge uses (not `font-mono` — the mockup's
 * `.vbolt` inherits `.vsplit`'s display-type weight for both exhibits).
 *
 * Design-diff audit (round 2): the eyebrow, split, and score-tug bar are one `rounded-lg`
 * card (matching `NemesisAssignmentCard`'s own outer-boundary-only rounding) — corners live
 * on the outermost edges of the whole unit, never on an inner piece independently.
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
  weekStart,
  className = '',
}: NemesisHeadToHeadBannerProps) {
  const total = viewerScore + opponentScore;
  // A week with zero combined score (every row voided) has nothing to proportion — split the
  // bar evenly rather than divide by zero.
  const viewerPct = total > 0 ? (viewerScore / total) * 100 : 50;
  const opponentPct = 100 - viewerPct;
  const dim = loserOpacity(outcome);

  return (
    <div
      dir="ltr"
      data-testid="head-to-head-banner"
      className={`bg-bg overflow-hidden rounded-lg ${className}`}
    >
      {weekStart ? (
        <div className="flex items-center justify-between px-3 pt-2 font-mono text-[10px] uppercase">
          <span className="text-paper font-semibold tracking-[0.16em]">{`Week of ${formatShortDate(weekStart)}`}</span>
          <span className="text-gold tracking-[0.06em]">Verdict</span>
        </div>
      ) : null}
      <div className={`relative flex h-24 overflow-hidden ${weekStart ? 'mt-2' : ''}`}>
        <div
          className={`flex min-w-0 flex-1 items-center px-4 pr-8 ${VIEWER_HALF.half} ${dim.viewer}`}
        >
          <span className="font-display min-w-0 truncate text-lg leading-none font-bold uppercase">
            {viewerHandle}
          </span>
        </div>
        <div
          aria-hidden="true"
          className="bg-paper text-ink absolute top-0 left-1/2 flex h-full w-14 -translate-x-1/2 items-center justify-center font-display text-base font-bold"
          style={{ clipPath: 'polygon(32% 0, 100% 0, 68% 100%, 0 100%)' }}
        >
          {viewerScore}–{opponentScore}
        </div>
        <div
          className={`flex min-w-0 flex-1 items-center justify-end px-4 pl-8 text-right ${OPPONENT_HALF.half} ${dim.opponent}`}
        >
          <span className="font-display min-w-0 truncate text-lg leading-none font-bold uppercase">
            {opponentHandle}
          </span>
        </div>
      </div>
      <div
        role="img"
        aria-label={`Score split: ${viewerHandle} ${viewerScore}, ${opponentHandle} ${opponentScore}`}
        className="mx-3 my-3 flex h-2 overflow-hidden rounded-full bg-surface"
      >
        <span className={VIEWER_HALF.bar} style={{ width: `${viewerPct}%` }} />
        <span className={OPPONENT_HALF.bar} style={{ width: `${opponentPct}%` }} />
      </div>
    </div>
  );
}
