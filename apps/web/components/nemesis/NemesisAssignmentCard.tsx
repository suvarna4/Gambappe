import Link from 'next/link';
import { nemesisCopy } from '@/lib/copy';
import { formatShortDate } from '@/lib/format-et';
import type { PairingSide } from '@/lib/nemesis/types';

export interface NemesisAssignmentCardProps {
  opponent: PairingSide;
  isRematch: boolean;
  /** The pairing's `week_start` (`YYYY-MM-DD`) — powers the topbar eyebrow's real date, in place
   * of a fictional week number (see this file's header). */
  weekStart: string;
  className?: string;
}

/**
 * The "Monday — meet your nemesis" assignment reveal (design-diff audit: `docs/mockups/
 * swipe-ux.html` "04 NEMESIS" exhibit 1, "ASSIGNMENT DAY", lines ~813-829 — its `.topbar`
 * eyebrow row + `.vsplit`/`.vbolt` "VS" badge). This card originally shipped (WS7-T6) as a
 * plain `TicketCard` text block; this redesign gives it the mockup's actual bold header
 * treatment instead.
 *
 * Reuses the SAME diamond-clip-path badge + fixed-position side-a/side-b gradient-half
 * technique `NemesisHeadToHeadBanner` built for the Friday verdict exhibit (git log that file
 * for the "match the mockup's visual weight" series) — one visual language for both nemesis-week
 * "split header" moments, not two near-misses. Two differences from that banner, both real
 * differences between the two mockup exhibits, not divergent choices:
 *   1. The center badge here shows the literal text "VS", never a score — assignment day is
 *      BEFORE any picks land, so there's nothing to score yet (the verdict exhibit's "4–1" badge
 *      is a later moment in the same week).
 *   2. Neither half dims — there's no winner/loser yet either.
 *
 * No fictional "WEEK 30"-style number: this codebase tracks only `week_start` dates (no
 * week-number concept anywhere), so the topbar eyebrow reuses the exact "Week of {short date}"
 * convention `lib/reveal-payload.ts`'s nemesis-flip narration already established for this same
 * mockup footer text, via `formatShortDate` (`lib/format-et.ts`) — one date-formatting
 * convention, not a hand-rolled second one. Emphasis follows the mockup's own `.topbar .brand`
 * vs status-label split exactly (`docs/mockups/swipe-ux.html` lines 145-146, 817): the left
 * (date) side is the bold/bright one (`text-paper font-semibold tracking-[0.16em]`, standing in
 * for the mockup's `--cream`), the right (status) side is dimmer and tighter-tracked (`text-gold
 * tracking-[0.06em]`, no bold) — not the other way around.
 *
 * Complete literal Tailwind class strings throughout (never `` `bg-${x}` `` concatenation) — see
 * `NemesisHeadToHeadBanner`'s header for why a dynamically-assembled class string gets silently
 * purged from the production CSS.
 */
export function NemesisAssignmentCard({
  opponent,
  isRematch,
  weekStart,
  className = '',
}: NemesisAssignmentCardProps) {
  return (
    <div
      data-testid="nemesis-assignment-card"
      className={`bg-bg overflow-hidden rounded-lg shadow-[0_14px_34px_rgba(0,0,0,0.35)] ${className}`}
    >
      <div className="flex items-center justify-between px-3 pt-2 font-mono text-[10px] uppercase">
        <span className="text-paper font-semibold tracking-[0.16em]">{`Week of ${formatShortDate(weekStart)}`}</span>
        <span className="text-gold tracking-[0.06em]">
          {isRematch ? 'Rematch day' : 'Assignment day'}
        </span>
      </div>

      <div className="relative mt-2 flex h-24 overflow-hidden">
        <div className="flex min-w-0 flex-1 items-center bg-gradient-to-br from-side-a/45 via-side-a/15 to-transparent px-4">
          <span className="font-display text-side-a min-w-0 truncate text-lg leading-none font-bold uppercase">
            You
          </span>
        </div>
        <div
          aria-hidden="true"
          className="bg-paper text-ink absolute top-0 left-1/2 flex h-full w-14 -translate-x-1/2 items-center justify-center font-display text-sm font-bold uppercase"
          style={{ clipPath: 'polygon(32% 0, 100% 0, 68% 100%, 0 100%)' }}
        >
          VS
        </div>
        <div className="flex min-w-0 flex-1 items-center justify-end bg-gradient-to-bl from-side-b/45 via-side-b/15 to-transparent px-4 text-right">
          <span className="font-display text-side-b min-w-0 truncate text-lg leading-none font-bold uppercase">
            {opponent.handle}
          </span>
        </div>
      </div>

      <div className="space-y-2 px-4 pt-3 pb-4">
        {opponent.rating ? (
          <p className="font-mono text-sm">
            {Math.round(opponent.rating.glicko_rating)}
            <span className="text-muted"> rating</span>
            {opponent.rating.accuracy_percentile !== null ? (
              <span className="text-muted"> · Top {100 - opponent.rating.accuracy_percentile}%</span>
            ) : null}
          </p>
        ) : null}
        <p className="text-muted text-sm">
          {nemesisCopy.assignmentBody(opponent.handle, isRematch)}
        </p>
        <Link
          href="/nemesis/matchup"
          className="text-side-a mt-1 inline-block text-sm font-medium underline underline-offset-2"
        >
          {nemesisCopy.viewMatchupCta}
        </Link>
      </div>
    </div>
  );
}
