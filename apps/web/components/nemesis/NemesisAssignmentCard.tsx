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
  /** Real count of `kind === 'daily'` rows on this pairing's own scoreboard (`app/nemesis/
   * page.tsx`) — the shared questions are already linked the moment the pairing exists (masking
   * only nulls RESULTS, not rows), so this is known before anyone picks. Powers the "THE WEEK"
   * empty-dot strip (design-diff audit — an earlier pass skipped this as needing data that
   * turned out to already be available). */
  sharedDayCount: number;
  /** Whether this week has a `nemesis_bonus` row — real, not the mockup's fabricated "+2 BONUS"
   * count. */
  hasBonusQuestion: boolean;
  className?: string;
}

/**
 * The "Monday — meet your nemesis" assignment reveal (design-diff audit: `docs/mockups/
 * swipe-ux.html` "04 NEMESIS" exhibit 1, "ASSIGNMENT DAY", lines ~813-829 — its `.topbar`
 * eyebrow row + `.vsplit`/`.vbolt` "VS" badge + `.wells` action row). This card originally
 * shipped (WS7-T6) as a plain `TicketCard` text block; this redesign gives it the mockup's
 * actual bold header treatment instead.
 *
 * Reuses the SAME diamond-clip-path badge + fixed-position side-a/side-b flat-tint-half
 * technique `NemesisHeadToHeadBanner` built for the Friday verdict exhibit (git log that file
 * for the "match the mockup's visual weight" series) — one visual language for both nemesis-week
 * "split header" moments, not two near-misses. Two differences from that banner, both real
 * differences between the two mockup exhibits, not divergent choices:
 *   1. The center badge here shows the literal text "VS", never a score — assignment day is
 *      BEFORE any picks land, so there's nothing to score yet (the verdict exhibit's "4–1" badge
 *      is a later moment in the same week).
 *   2. Neither half dims — there's no winner/loser yet either.
 *   3. The badge is 15px (the mockup's `.vbolt` base rule, unoverridden here) — the verdict
 *      exhibit's own badge shrinks to 12px instead, an inversion an earlier pass had backwards.
 * The split itself is inset 12px from the card edges with `rounded-[10px]` corners
 * (`.vsplit{margin:8px 12px 0;border-radius:10px}`), not flush/square — a structural detail an
 * earlier pass dropped.
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
 * The action row reuses the mockup's own `.well` treatment (`docs/mockups/swipe-ux.html` line
 * 825: two bordered pill buttons, not plain text links) for BOTH actions: "Pause weeks" is a
 * real shortcut to the `nemesis_paused` toggle already on `/settings`
 * (`SettingsClient.tsx`'s `saveNemesisPaused`), not a new feature invented for this card; "View
 * matchup" keeps this app's own established copy (not the mockup's literal "See the matchup")
 * but adopts its gold-bordered well styling — the mockup itself overrides this specific well to
 * gold rather than the generic yes-color well, matching this app's own convention of reserving
 * gold for ritual/CTA moments.
 *
 * Design-diff audit (round 3): the topbar's padding now matches the mockup's own `.topbar
 * {padding:8px 14px 4px}` exactly (`px-[14px] pt-2 pb-1`, was `px-3 pt-2` with no bottom
 * padding) — the mockup's own vsplit margin (12px) is genuinely 2px narrower than its topbar
 * padding (14px), so this small horizontal mismatch between the eyebrow text and the split
 * below it is faithful, not an oversight. The "THE WEEK" day-count strip (`sharedDayCount` empty
 * dots, `hasBonusQuestion` real bonus flag) now renders too — an earlier pass skipped it as
 * needing data this app doesn't model, which turned out to be wrong: the pairing's scoreboard
 * already carries every shared question the moment it's assigned.
 *
 * Not reproduced (design-diff audit, flagged rather than silently dropped): the mockup's
 * per-player style-tag subtitle ("longshot chaser · early locker") and the "THE ENGINE'S CASE
 * FILE" narrative box need data this app doesn't model (`PairingSide` has no style-tag or
 * lock-time-habit fields); the footer disclaimer line is a product-copy decision this task
 * doesn't own.
 *
 * Complete literal Tailwind class strings throughout (never `` `bg-${x}` `` concatenation) — see
 * `NemesisHeadToHeadBanner`'s header for why a dynamically-assembled class string gets silently
 * purged from the production CSS.
 */
export function NemesisAssignmentCard({
  opponent,
  isRematch,
  weekStart,
  sharedDayCount,
  hasBonusQuestion,
  className = '',
}: NemesisAssignmentCardProps) {
  return (
    <div
      data-testid="nemesis-assignment-card"
      className={`bg-bg overflow-hidden rounded-lg shadow-[0_14px_34px_rgba(0,0,0,0.35)] ${className}`}
    >
      <div className="flex items-center justify-between px-[14px] pt-2 pb-1 font-mono text-[9.5px] uppercase">
        <span className="text-paper font-semibold tracking-[0.16em]">{`Week of ${formatShortDate(weekStart)}`}</span>
        <span className="text-gold tracking-[0.06em]">
          {isRematch ? 'Rematch day' : 'Assignment day'}
        </span>
      </div>

      <div className="relative mx-3 mt-2 flex h-[104px] overflow-hidden rounded-[10px]">
        <div className="flex min-w-0 flex-1 items-center bg-side-a/15 px-4">
          <span className="font-display text-side-a min-w-0 truncate text-lg leading-none font-bold uppercase">
            You
          </span>
        </div>
        <div
          aria-hidden="true"
          className="bg-paper text-ink absolute top-0 left-1/2 flex h-full w-[34px] -translate-x-1/2 items-center justify-center font-display text-[15px] font-bold uppercase"
          style={{ clipPath: 'polygon(28% 0, 100% 0, 72% 100%, 0 100%)' }}
        >
          VS
        </div>
        <div className="flex min-w-0 flex-1 items-center justify-end bg-side-b/15 px-4 text-right">
          <span className="font-display text-side-b min-w-0 truncate text-lg leading-none font-bold uppercase">
            {opponent.handle}
          </span>
        </div>
      </div>

      {sharedDayCount > 0 ? (
        <div
          dir="ltr"
          aria-hidden="true"
          className="text-muted mx-3 mt-1.5 flex items-center gap-[5px] font-mono text-[8px] uppercase"
        >
          <span>The week</span>
          {Array.from({ length: sharedDayCount }, (_, i) => (
            <span key={i} className="border-muted h-[11px] w-[11px] rounded-full border-[1.5px]" />
          ))}
          {hasBonusQuestion ? <span className="ml-auto">+1 bonus</span> : null}
        </div>
      ) : null}

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
        <div className="flex gap-2 pt-1">
          <Link
            href="/settings"
            className="border-muted text-muted flex-1 rounded-[9px] border-[1.5px] py-2 text-center font-display text-[12.5px] font-bold tracking-[0.08em] uppercase"
          >
            {nemesisCopy.pauseWeeksCta}
          </Link>
          <Link
            href="/nemesis/matchup"
            className="border-gold text-gold flex-1 rounded-[9px] border-[1.5px] py-2 text-center font-display text-[12.5px] font-bold tracking-[0.08em] uppercase"
          >
            {nemesisCopy.viewMatchupCta}
          </Link>
        </div>
      </div>
    </div>
  );
}
