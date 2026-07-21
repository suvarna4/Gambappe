import { formatShortDate } from '@/lib/format-et';
import type { DayResult, VerdictOutcome } from './VerdictCard';

export interface NemesisHeadToHeadBannerProps {
  viewerHandle: string;
  opponentHandle: string;
  viewerScore: number;
  opponentScore: number;
  /** The settled pairing's `week_start` (`YYYY-MM-DD`) — when present, renders a "Week of
   * {date} / Verdict" eyebrow above the split, the same topbar treatment
   * `NemesisAssignmentCard` uses for its "Week of {date} / Assignment day" row (one eyebrow
   * convention for both nemesis-week split moments). Optional so this component's own render
   * tests can exercise it without a real date. */
  weekStart?: string;
  /** Same authoritative outcome `VerdictCard` renders for this entry — used only to decide
   * which side dims (never re-derived from the raw scores here), because a tiebreak week can
   * have `viewerScore === opponentScore` and still carry a real `won`/`lost` outcome (§SW10-T2's
   * "closed it out on the tiebreak" case, `copy.ts`'s `verdictWinnerLine`/`verdictLoserLine`
   * margin-0 branch) — recomputing from the scores alone would render that week as a false
   * dead-even split. */
  outcome: VerdictOutcome;
  /** Per-day results for the "DAYS" dot strip below the score-tug bar (design-diff audit: the
   * mockup's verdict exhibit puts this row between `.tug` and the loser's card,
   * `docs/mockups/swipe-ux.html` line 868 — NOT inside the paper card the way an earlier pass
   * had it, via `VerdictCard`'s own dot strip). Optional — the strip is skipped entirely when
   * absent (e.g. this component's own render tests). */
  dayResults?: ReadonlyArray<DayResult>;
  className?: string;
}

interface SideVisual {
  half: string;
  bar: string;
}

/** Fixed by POSITION, not by outcome — this is the mockup's actual scheme for this exhibit
 * (`docs/mockups/swipe-ux.html`'s `.vsplit .a`/`.vsplit .b`: dark navy on the left, dark maroon
 * on the right, bright `--yes-hot`/`--no-hot` text on top of each, same left/right pairing
 * regardless of who's who). The mockup's own halves are technically a two-stop
 * `linear-gradient`, but between two near-identical dark shades (`#12203c`→`#0e1526`,
 * `#33190a`→`#1d1008`) — visually a flat fill, not a fade. A flat `bg-side-a/15`/`bg-side-b/15`
 * tint (no `bg-gradient-to-*` at all) reproduces that same near-black-with-a-hint-of-hue color
 * almost exactly (alpha-blending `side-a` #3B82F6 at 15% over this app's `bg` #0B0B0D lands on
 * `#121d30`, a couple RGB points from the mockup's own gradient average `#101a31`; `side-b` at
 * 15% over `bg` lands on `#2f1b0e` vs the mockup's average `#281409` — same math for both sides).
 * `/20` (an earlier pass) overshoots into a visibly more blue/orange panel than the mockup's
 * near-black one. Reusing this app's own `side-a`/`side-b` tokens (already `#3B82F6`/`#F97316`,
 * functionally the same "voltage" blue/orange the mockup's custom `--yes-hot`/`--no-hot` values
 * approximate) rather than inventing a third color pair — one match instead of a near-miss.
 * Complete literal Tailwind class strings throughout (never `` `bg-${x}` `` template
 * concatenation): Tailwind's compiler statically greps source files for whole class names, so a
 * dynamically-assembled string is invisible to it and gets purged from the production CSS,
 * silently rendering unstyled. */
const VIEWER_HALF: SideVisual = {
  half: 'bg-side-a/15 text-side-a',
  bar: 'bg-side-a',
};
const OPPONENT_HALF: SideVisual = {
  half: 'bg-side-b/15 text-side-b',
  bar: 'bg-side-b',
};

/** Which side dims — the ONLY outcome-driven visual in the split. The mockup's own trick: both
 * halves keep their fixed blue/orange treatment; the *loser's* whole half (background AND text
 * together) is simply dialed down via a flat `opacity:.55` — "the winner shines, the loser
 * fades" — rather than either side switching color families. A draw dims neither. */
function loserOpacity(outcome: VerdictOutcome): { viewer: string; opponent: string } {
  if (outcome === 'won') return { viewer: '', opponent: 'opacity-[0.55]' };
  if (outcome === 'lost') return { viewer: 'opacity-[0.55]', opponent: '' };
  return { viewer: '', opponent: '' };
}

/** Same four-state dot palette `VerdictCard` used before this strip moved here — win/loss/split
 * (`neutral`)/`pending`, matching the mockup's `.dot2.w`/`.dot2.l`/`.dot2.s`/plain-outline states
 * (`docs/mockups/swipe-ux.html` lines 295-298). */
const DOT: Record<DayResult, string> = {
  win: 'bg-win border-win',
  loss: 'bg-loss border-loss',
  neutral: 'bg-muted border-muted',
  pending: 'border-muted',
};

/**
 * Head-to-head summary banner for a settled nemesis week (design-diff audit: the mockup's
 * Friday verdict exhibit, `docs/mockups/swipe-ux.html` "WEEK 30 · VERDICT" — its `.vsplit`
 * block: two big display-type name halves and a clipped "vbolt" score badge between them, a
 * `.tug` bar below, then a `.dots` day-strip). Matches the mockup's actual color scheme, not a
 * red/green win/loss split: fixed dark navy/blue (viewer, left) and dark maroon/orange
 * (opponent, right) panels — the SAME pairing regardless of who won — with only the loser's half
 * dimmed via opacity. The `.tug` bar below keeps the same fixed blue/orange pairing too (the
 * mockup's own bar never changes color by winner either, `.tug .ty`/`.tug .tn` are plain fixed
 * yes/no colors). The center badge keeps the real score (`4–1`), matching this exact exhibit, in
 * the same bold `font-display` face `NemesisAssignmentCard`'s "VS" badge uses (not `font-mono` —
 * the mockup's `.vbolt` inherits `.vsplit`'s display-type weight for both exhibits), sized 12px —
 * SMALLER than the assignment exhibit's badge (`.vbolt` has no font-size override there, so it
 * inherits the base rule's 15px) — the mockup shrinks this specific badge, an inversion an
 * earlier pass had backwards.
 *
 * Structure mirrors the mockup's own independent pieces, not one wrapping card: the eyebrow is
 * plain text with no box of its own; the split is its own `rounded-[10px]` rectangle inset 12px
 * from the surrounding edges (`.vsplit{border-radius:10px;margin:8px 12px 0}`); the score-tug
 * bar is its own separately-rounded pill, also inset 12px (`.tug{margin:0 12px;border-radius:
 * 4px}`); the day-strip sits below that, un-boxed, matching `.dots`'s own plain-text-row
 * treatment. Each with its own corners/margin, the way `docs/mockups/swipe-ux.html` actually
 * lays these out — no shared card wrapping them.
 *
 * Still real-data-only: the mockup's own subtitle text for this exhibit is "3 right · edge +11"
 * — a fabricated per-day/edge stat that doesn't exist on `nemesisHistoryEntrySchema`
 * (`my_score`/`their_score` only), so it stays out, matching `VerdictCard`'s own pinned
 * constraint (`copy.ts`'s `verdictWinnerLine`/`verdictLoserLine`, whose doc comment says the
 * same thing: "the prior 'edge' framing implied data ... that doesn't exist"). The mockup's
 * trailing "SPLIT DAY 5" day-strip label (a still-in-progress week's live status) has no
 * equivalent for a concluded week either — every day is already final by the time this promotes
 * to primary content — so the strip has no trailing label here, just "DAYS" + the dots.
 *
 * Design-diff audit (round 3): the eyebrow's padding now matches the mockup's own `.topbar
 * {padding:8px 14px 4px}` proportionally (not literally — see round 4 below). The caller
 * (`app/nemesis/page.tsx`) now derives `dayResults` via `deriveWeekDayResults`, always exactly
 * `NEMESIS_SHARED_WEEK_DAYS` (7) entries keyed by calendar date — this strip was briefly
 * rendering a different dot count than `NemesisAssignmentCard`'s own "THE WEEK" strip, because
 * the old row-order-based derivation could under- or over-count depending on which real
 * scoreboard rows an environment happened to have.
 *
 * Design-diff audit (round 4): every measurement here is the mockup's own px value scaled ×1.4,
 * not copied literally — see `NemesisAssignmentCard`'s own round-4 note for why (this app's real
 * mobile viewport, ≈340-390px, is meaningfully wider than the mockup's 250px demo phone screen;
 * copying its pixel values 1:1 reproduces the LAYOUT at roughly 70% of its actual physical size).
 * `em`-based letter-spacing and percentage widths are already scale-invariant and stay as-is.
 *
 * Design-diff audit (round 6): `app/nemesis/page.tsx`'s wrapping div now cancels `<main>`'s own
 * `px-6` page-shell margin via `-mx-6` — see `NemesisAssignmentCard`'s own round-6 note for why
 * (the mockup's `.scr` has zero padding of its own, so stacking `<main>`'s separate 24px page
 * margin on top of this banner's own scaled insets, `mx-[17px]`/`px-5`, doubled the effective
 * margin the mockup never has).
 *
 * Design-diff audit (round 5): names WRAP to a second line instead of truncating with an
 * ellipsis — see `NemesisAssignmentCard`'s own round-5 note for why (no mockup precedent either
 * way; wrapping reads better than a clipped "SHOWCA…" for a real handle this app can't bound the
 * length of).
 *
 * Pure/presentational — mounted directly above `RematchPanel` for the promoted `verdict` state
 * on `/nemesis` (`app/nemesis/page.tsx`), the only remaining caller now that the plain lifetime
 * history list (`/nemesis/history`) dropped this banner for a compact read-only row instead.
 */
export function NemesisHeadToHeadBanner({
  viewerHandle,
  opponentHandle,
  viewerScore,
  opponentScore,
  outcome,
  weekStart,
  dayResults,
  className = '',
}: NemesisHeadToHeadBannerProps) {
  const total = viewerScore + opponentScore;
  // A week with zero combined score (every row voided) has nothing to proportion — split the
  // bar evenly rather than divide by zero.
  const viewerPct = total > 0 ? (viewerScore / total) * 100 : 50;
  const opponentPct = 100 - viewerPct;
  const dim = loserOpacity(outcome);

  return (
    <div dir="ltr" data-testid="head-to-head-banner" className={`space-y-2 ${className}`}>
      {weekStart ? (
        <div className="flex items-center justify-between px-5 pt-[11px] pb-[6px] font-mono text-[13px] uppercase">
          <span className="text-paper font-semibold tracking-[0.16em]">{`Week of ${formatShortDate(weekStart)}`}</span>
          <span className="text-gold tracking-[0.06em]">Verdict</span>
        </div>
      ) : null}
      <div className="bg-bg relative mx-[17px] mt-[11px] flex h-[109px] overflow-hidden rounded-[14px]">
        <div
          className={`flex min-w-0 flex-1 items-center py-2 pr-[45px] pl-5 ${VIEWER_HALF.half} ${dim.viewer}`}
        >
          <span className="font-display min-w-0 text-2xl leading-tight font-bold break-words uppercase">
            {viewerHandle}
          </span>
        </div>
        <div
          aria-hidden="true"
          className="bg-paper text-ink absolute top-0 left-1/2 flex h-full w-[48px] -translate-x-1/2 items-center justify-center font-display text-[17px] font-bold"
          style={{ clipPath: 'polygon(28% 0, 100% 0, 72% 100%, 0 100%)' }}
        >
          {viewerScore}–{opponentScore}
        </div>
        <div
          className={`flex min-w-0 flex-1 items-center justify-end py-2 pr-5 pl-[45px] text-right ${OPPONENT_HALF.half} ${dim.opponent}`}
        >
          <span className="font-display min-w-0 text-2xl leading-tight font-bold break-words uppercase">
            {opponentHandle}
          </span>
        </div>
      </div>
      <div
        role="img"
        aria-label={`Score split: ${viewerHandle} ${viewerScore}, ${opponentHandle} ${opponentScore}`}
        className="bg-surface mx-[17px] flex h-[18px] overflow-hidden rounded-[6px]"
      >
        <span className={VIEWER_HALF.bar} style={{ width: `${viewerPct}%` }} />
        <span className={OPPONENT_HALF.bar} style={{ width: `${opponentPct}%` }} />
      </div>
      {dayResults && dayResults.length > 0 ? (
        <div
          dir="ltr"
          aria-hidden="true"
          className="text-muted flex items-center gap-[7px] px-5 font-mono text-[11px] uppercase"
        >
          <span>Days</span>
          {dayResults.map((r, i) => (
            <span key={i} className={`h-[15px] w-[15px] rounded-full border-2 ${DOT[r]}`} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
