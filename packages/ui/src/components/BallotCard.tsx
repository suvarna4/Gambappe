import type { ReactNode } from 'react';

import { impliedCents, type MarketSide } from '../format.js';
import { sideAxisPair } from '../side-axis.js';

/** Design-diff audit: the mockup's own `.perf{background-image:radial-gradient(circle at
 * center,var(--ink) 40%,transparent 46%);background-size:10px 10px}` (`docs/mockups/
 * swipe-ux.html`) — an earlier pass here used a narrower `40%,transparent 42%` falloff and a
 * 12px size, both close-but-not-exact guesses rather than the mockup's real values, which read
 * as smaller/harder-edged dashes instead of the mockup's larger, softer punched circles. Scaled
 * ×1.4 for the same real-viewport-vs-250px-demo-frame reason every other measurement here is
 * (see this file's header). */
const PUNCH_SIZE = 14;
/** Same perforated edge as `TicketCard` (§10.4) — the ballot is a ticket you throw. Punched
 * against the dark stage `bg`, so the holes read as cut-through paper. */
const perforationStyle = {
  backgroundImage: 'radial-gradient(circle at center, #0B0B0D 40%, transparent 46%)',
  backgroundSize: `${PUNCH_SIZE}px ${PUNCH_SIZE}px`,
  backgroundRepeat: 'repeat-x',
  backgroundPosition: 'center',
} as const;

interface SidePriceProps {
  side: MarketSide;
  label: string;
  yesProbability: number;
}

/**
 * One side's printed price chip. Side identity is carried by the colored border + dot (UI
 * elements, AA at 3:1) — the label and cents used to render in flat `ink` regardless of side, to
 * avoid relying on side hues for text contrast, since the bright #3B82F6/#F97316 tokens fail AA
 * on paper. Design-diff audit: the mockup's own `.pt.yes{color:#1d4fa8}`/`.pt.no{color:#b34d0a}`
 * (`docs/mockups/swipe-ux.html`) colors the WHOLE chip's text by side too, not just the border —
 * these are the same darkened, AA-safe (~6:1) side variants `PriceTag.tsx` already established
 * for exactly this reason (its own header has the contrast math), just not applied here yet.
 * `data-side` anchors the axis-order tests.
 *
 * Design-diff audit: `leading-[1.6]` on both lines and `mt-[1.4px]` on the value line match the
 * mockup's own inherited `html,body{line-height:1.6}` (nothing on `.pt .l`/`.pt .v` overrides it)
 * and `.v{margin-top:1px}` (×1.4). Padding/border/font-size here already matched the mockup's own
 * `.pt{padding:5px 7px 4px;border:1.5px solid}`/`.l{font-size:8px}`/`.v{font-size:15px}` values
 * scaled ×1.4 exactly — but this file's spans had no explicit `leading-*`, so they fell back to
 * the app's own global line-height (1.5, not the mockup's 1.6) and had no gap between the two
 * lines at all, measurably shrinking the chip below the mockup's own proportions (measured: mockup
 * `.pt` is 79.5×48.8 at its own scale, h/w≈0.614; the live chip measured 130×65, h/w≈0.5, before
 * this fix) — read by the user as "the stamps appear to be taller [in the mockup]".
 */
function SidePrice({ side, label, yesProbability }: SidePriceProps) {
  const cents = impliedCents(side, yesProbability);
  const accent = side === 'yes' ? 'border-side-a' : 'border-side-b';
  const dot = side === 'yes' ? 'bg-side-a' : 'bg-side-b';
  const text = side === 'yes' ? 'text-[#1d4fa8]' : 'text-[#b34d0a]';
  return (
    <div
      data-side={side}
      className={`${accent} ${text} flex flex-1 flex-col rounded-[8px] border-2 px-[10px] pt-[7px] pb-[6px]`}
    >
      <span className="flex items-center gap-1.5 font-mono text-[11px] leading-[1.6] font-normal tracking-wider uppercase">
        <span aria-hidden="true" className={`${dot} h-2 w-2 rounded-full`} />
        {label}
      </span>
      <span
        className="mt-[1.4px] font-mono text-[21px] leading-[1.6] font-semibold"
        aria-label={`${label}: ${cents}% implied`}
      >
        @ {cents}¢
      </span>
    </div>
  );
}

export interface BallotCardProps {
  /** Kicker row, left — e.g. "ECON · DAILY" (caller composes from `kind`/category). */
  eyebrow: string;
  /** Kicker row, right — e.g. "№ 212" (caller derives from the slug). */
  serial: string;
  headline: string;
  yesLabel: string;
  noLabel: string;
  /** Live venue yes-probability (0–1). Drives both printed cents; the value the receipt
   * stamps is set server-side at release (§6.2), never from this render. */
  yesProbability: number;
  /** Footer left — e.g. "KALSHI · LIVE". */
  venue: string;
  /** Footer right — e.g. "LOCKS 9:00 AM PT". */
  lockLabel: string;
  className?: string;
  /**
   * Absolutely-positioned overlay slot inside the card (the SW1-T2 stamp preview lives here).
   * Presentational only — `BallotCard` never reads or animates it.
   */
  overlay?: ReactNode;
}

/**
 * SW1-T1 · The face of the swipe ballot (swipe-ux-plan §2.3): a paper ticket carrying the
 * question. Pure / presentational (props in, DOM out, §10.4 rule) so `SwipeBallot` (SW1-T2),
 * the deck's static server shell (SW2-T1), and satori card templates (SW4-T2) all render the
 * same layout. No gesture, state, or client code lives here.
 *
 * The price row obeys the side-axis rule (§2.2, D-SW9): NO/against chip left, YES/for chip
 * right, built via `sideAxisPair` and wrapped in `dir="ltr"` so an RTL locale can't mirror the
 * gesture semantics.
 *
 * Design-diff audit: every measurement here is the mockup's own px value (`docs/mockups/
 * swipe-ux.html`'s `.card`/`.qcat`/`.qh`/`.pt`/`.qfoot`/`.perf`) scaled ×1.4 — an earlier pass
 * left this file's ORIGINAL, pre-mockup-audit sizing untouched (unlike `DeckTopbar`'s, which was
 * scaled from the start), so headline/eyebrow/price/footer text all read noticeably smaller than
 * the mockup's own proportions. `aspect-[98/150]` (the mockup's own `.deck{width:196px;
 * height:300px}` ratio, halved) replaces an earlier flex-grow-to-fill-available-space attempt —
 * that stretched the card to consume 100% of whatever height its ancestor chain happened to
 * have, which overshot the mockup's actual restraint (the mockup's card is a SPECIFIC size
 * within the stage, with real dark space left around it, not a card stretched to fill the whole
 * stage) and made margins/gaps read as disproportionate against it. A fixed aspect ratio against
 * the card's own (already correctly-proportioned) width gives `margin-top:auto` on the price row
 * real, bounded space to push into, matching the mockup's own generous headline-to-price gap
 * without over-inflating the card past what the mockup itself shows.
 */
export function BallotCard({
  eyebrow,
  serial,
  headline,
  yesLabel,
  noLabel,
  yesProbability,
  venue,
  lockLabel,
  className = '',
  overlay,
}: BallotCardProps) {
  const [leftChip, rightChip] = sideAxisPair(
    <SidePrice key="no" side="no" label={noLabel} yesProbability={yesProbability} />,
    <SidePrice key="yes" side="yes" label={yesLabel} yesProbability={yesProbability} />,
  );

  return (
    <div
      className={`bg-paper text-ink relative flex aspect-[98/150] flex-col rounded-[14px] px-[21px] pt-[22px] pb-[18px] shadow-[0_14px_34px_rgba(0,0,0,0.5)] ${className}`}
    >
      <div aria-hidden="true" className="-mx-[21px] -mt-[11px] mb-2 h-[7px]" style={perforationStyle} />

      {/* Muted labels on paper use ink-at-70% (not `text-muted`, which is tuned for the dark bg
          and fails AA on paper — caught by the SW8-T1 axe pass). */}
      <div className="text-ink/70 flex items-center justify-between font-mono text-[12px] font-semibold tracking-widest uppercase">
        <span>{eyebrow}</span>
        <span>{serial}</span>
      </div>

      <h2 className="font-display mt-[14px] text-[32px] leading-[1.02] font-bold uppercase">
        {headline}
      </h2>

      <div dir="ltr" className="mt-auto flex gap-[10px] pt-4">
        {leftChip}
        {rightChip}
      </div>

      <div className="text-ink/70 mt-[13px] flex items-center justify-between font-mono text-[11px] tracking-wide uppercase">
        <span>{venue}</span>
        <span>{lockLabel}</span>
      </div>

      <div aria-hidden="true" className="-mx-[21px] mt-2 -mb-[7px] h-[7px]" style={perforationStyle} />

      {overlay}
    </div>
  );
}

export interface UnderCardProps {
  /** e.g. "TOMORROW · opens 12:00 AM PT"; omit for a blank slip. */
  label?: string;
  className?: string;
}

/**
 * SW1-T1 · The card peeking from under the ballot in the deck (§2.5): tomorrow's appointment
 * or a blank slip. Never interactive; dimmed and scaled by the deck shell (SW2-T1), so this is
 * just the paper + optional kicker.
 *
 * Design-diff audit fix: the base classes deliberately carry NO `position` utility. Every real
 * caller (`DeckStage`, `SwipeBallot`, `/dev/ui`'s `gallery-ballotcard` tile) passes `absolute
 * ...` via `className` to peek from behind another card — but Tailwind's generated stylesheet
 * happens to emit `.relative` after `.absolute` (same specificity, source-order tiebreak), so a
 * hardcoded base `relative` here would silently outrank every caller's `absolute` override,
 * leaving the card in normal flow instead of layered behind its sibling (confirmed via the
 * compiled CSS, not just visually: `.absolute{position:absolute}` then `.relative{position:
 * relative}` later in the same stylesheet). Letting the caller own `position` entirely avoids
 * that trap.
 */
export function UnderCard({ label, className = '' }: UnderCardProps) {
  return (
    <div
      aria-hidden="true"
      className={`bg-paper text-ink/70 flex flex-col rounded-[14px] px-[21px] pt-[22px] pb-[18px] ${className}`}
    >
      <div className="-mx-[21px] -mt-[11px] mb-2 h-[7px]" style={perforationStyle} />
      {label ? (
        <span className="font-mono text-[12px] font-semibold tracking-widest uppercase">
          {label}
        </span>
      ) : null}
      <div className="-mx-[21px] mt-auto -mb-[7px] h-[7px]" style={perforationStyle} />
    </div>
  );
}
