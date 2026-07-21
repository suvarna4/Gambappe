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
  /** `NEMESIS_SHARED_WEEK_DAYS` (7, `lib/nemesis/verdict.ts`) — the whole `[week_start,
   * week_start+6]` shared-set definition, not a count of however many `daily` rows a given
   * environment happens to have actually seeded (design-diff audit: an earlier pass derived it
   * from the real row count, which could under-count in a sparsely-seeded dev DB and drift from
   * the verdict exhibit's own dot count). Powers the "THE WEEK" empty-dot strip. */
  sharedDayCount: number;
  /** The real number of `nemesis_bonus` rows this week (§8.8: 2–3 per pairing, or 0 on the
   * documented fallback — never fabricated like the mockup's own hardcoded "+2 BONUS"). Design-
   * diff audit (round 8): an earlier pass collapsed this to a boolean and then hard-coded the
   * displayed count to "+1", which is real-week-impossible (0/2/3 only) and exactly the kind of
   * fabricated number this prop's own doc comment claims to avoid. */
  bonusQuestionCount: number;
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
 *   3. The badge text is the mockup's `.vbolt` base rule scaled (15px × 1.4 ≈ 21px), unoverridden
 *      here — the verdict exhibit's own badge shrinks to 12px (×1.4 ≈ 17px) instead, an inversion
 *      an earlier pass had backwards.
 * The split itself is inset from the card edges with rounded corners
 * (`.vsplit{margin:8px 12px 0;border-radius:10px}`, scaled), not flush/square — a structural
 * detail an earlier pass dropped.
 *
 * Design-diff audit (round 5): names WRAP to a second line instead of truncating with an
 * ellipsis (an earlier pass's `truncate`) — the mockup's own examples ("Fox #4821", "Maria O.")
 * are short enough to never need either treatment, so there's no mockup precedent to match; a
 * clipped "NEMESIS RI…" reads worse than two shorter lines for a real handle this app can't
 * control the length of. Each half keeps extra inner (badge-side) padding so a wrapped second
 * line still clears the center "VS" badge rather than running underneath it.
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
 * Design-diff audit (round 3): the topbar's padding matches the mockup's own `.topbar
 * {padding:8px 14px 4px}` proportionally (not literally — see round 4 below). The "THE WEEK"
 * day-count strip (`sharedDayCount` empty dots, `bonusQuestionCount` real bonus count) now renders
 * too — an earlier pass skipped it as needing data this app doesn't model, which turned out to
 * be wrong: the pairing's scoreboard already carries every shared question the moment it's
 * assigned.
 *
 * Design-diff audit (round 4): every measurement here is the mockup's own px value scaled ×1.4,
 * not copied literally. The mockup's phone screen (`.ph .scr`) is 250px wide with NO padding of
 * its own — a demo-frame convenience, not this app's real target — while this card renders in a
 * real mobile viewport (≈340-390px). Copying the mockup's pixel values 1:1 (an earlier pass's
 * mistake) reproduces its LAYOUT at roughly 70% of its actual physical size, since a real phone
 * viewport is meaningfully wider than the demo frame. ×1.4 (350/250) restores the mockup's own
 * proportions — every width, height, padding, margin, and font-size below is
 * `Math.round(mockupPx * 1.4)` — while `em`-based letter-spacing and percentage widths (already
 * scale-invariant) are untouched.
 *
 * Design-diff audit (round 6): this card (and `app/nemesis/page.tsx`'s wrapping div) now cancel
 * `<main>`'s own `px-6` page-shell margin via `-mx-6`, rendering flush to the real viewport edge —
 * the mockup's `.scr` has ZERO padding of its own, so its `.topbar`/`.vsplit` insets ARE the full
 * margin from the physical screen edge; stacking this card's own scaled insets (topbar `px-5`,
 * vsplit `mx-[17px]`) on TOP of `<main>`'s separate 24px page margin (an earlier pass's mistake)
 * doubled the effective margin the mockup never has, reading as noticeably wider gutters than the
 * mockup's own tight-to-the-glass layout. Also dropped this card's own outer `rounded-lg
 * shadow-[...]` box (an earlier pass invented it) — the mockup's assignment exhibit has no
 * enclosing card wrapping the topbar/vsplit/week-strip/wells; they're independent flat pieces
 * directly on the screen background, exactly like `NemesisHeadToHeadBanner`'s own structure (see
 * that file's header) — this card was the one inconsistent sibling with a phantom box around it.
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
  bonusQuestionCount,
  className = '',
}: NemesisAssignmentCardProps) {
  return (
    <div data-testid="nemesis-assignment-card" className={className}>
      <div className="flex items-center justify-between px-5 pt-[11px] pb-[6px] font-mono text-[13px] uppercase">
        <span className="text-paper font-semibold tracking-[0.16em]">{`Week of ${formatShortDate(weekStart)}`}</span>
        <span className="text-gold tracking-[0.06em]">
          {isRematch ? 'Rematch day' : 'Assignment day'}
        </span>
      </div>

      <div className="relative mx-[17px] mt-[11px] flex h-[146px] overflow-hidden rounded-[14px]">
        <div className="flex min-w-0 flex-1 items-center bg-side-a/15 py-2 pr-[38px] pl-5">
          <span className="font-display text-side-a min-w-0 text-2xl leading-tight font-bold break-words uppercase">
            You
          </span>
        </div>
        <div
          aria-hidden="true"
          className="bg-paper text-ink absolute top-0 left-1/2 flex h-full w-[48px] -translate-x-1/2 items-center justify-center font-display text-[21px] font-bold uppercase"
          style={{ clipPath: 'polygon(28% 0, 100% 0, 72% 100%, 0 100%)' }}
        >
          VS
        </div>
        <div className="flex min-w-0 flex-1 items-center justify-end bg-side-b/15 py-2 pr-5 pl-[38px] text-right">
          <span className="font-display text-side-b min-w-0 text-2xl leading-tight font-bold break-words uppercase">
            {opponent.handle}
          </span>
        </div>
      </div>

      {sharedDayCount > 0 ? (
        <div
          dir="ltr"
          aria-hidden="true"
          className="text-muted mx-[17px] mt-2 flex items-center gap-[7px] font-mono text-[11px] uppercase"
        >
          <span>The week</span>
          {Array.from({ length: sharedDayCount }, (_, i) => (
            <span key={i} className="border-muted h-[15px] w-[15px] rounded-full border-2" />
          ))}
          {bonusQuestionCount > 0 ? (
            <span className="ml-auto">
              +{bonusQuestionCount} bonus
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-3 px-5 pt-4 pb-5">
        {opponent.rating ? (
          <p className="font-mono text-base">
            {Math.round(opponent.rating.glicko_rating)}
            <span className="text-muted"> rating</span>
            {opponent.rating.accuracy_percentile !== null ? (
              <span className="text-muted"> · Top {100 - opponent.rating.accuracy_percentile}%</span>
            ) : null}
          </p>
        ) : null}
        <p className="text-muted text-base">
          {nemesisCopy.assignmentBody(opponent.handle, isRematch)}
        </p>
        <div className="flex gap-[11px] pt-1">
          <Link
            href="/settings"
            className="border-muted text-muted flex-1 rounded-[13px] border-2 py-[11px] text-center font-display text-[18px] font-bold tracking-[0.08em] uppercase"
          >
            {nemesisCopy.pauseWeeksCta}
          </Link>
          <Link
            href="/nemesis/matchup"
            className="border-gold text-gold flex-1 rounded-[13px] border-2 py-[11px] text-center font-display text-[18px] font-bold tracking-[0.08em] uppercase"
          >
            {nemesisCopy.viewMatchupCta}
          </Link>
        </div>
      </div>
    </div>
  );
}
