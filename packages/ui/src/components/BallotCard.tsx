import type { ReactNode } from 'react';

import { impliedCents, type MarketSide } from '../format.js';
import { sideAxisPair } from '../side-axis.js';

const PUNCH_SIZE = 12;
/** Same perforated edge as `TicketCard` (§10.4) — the ballot is a ticket you throw. Punched
 * against the dark stage `bg`, so the holes read as cut-through paper. */
const perforationStyle = {
  backgroundImage: 'radial-gradient(circle at center, #0B0B0D 40%, transparent 42%)',
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
 * elements, AA at 3:1) while the label and cents render in `ink` on paper (AA at 4.5:1) —
 * so the chip is unmistakably side-colored without relying on side hues for text contrast,
 * which #3B82F6 / #F97316 on paper would fail. `data-side` anchors the axis-order tests.
 */
function SidePrice({ side, label, yesProbability }: SidePriceProps) {
  const cents = impliedCents(side, yesProbability);
  const accent = side === 'yes' ? 'border-side-a' : 'border-side-b';
  const dot = side === 'yes' ? 'bg-side-a' : 'bg-side-b';
  return (
    <div
      data-side={side}
      className={`${accent} text-ink flex flex-1 flex-col rounded-md border-2 px-2.5 py-1.5`}
    >
      <span className="flex items-center gap-1.5 font-mono text-[10px] font-semibold tracking-wider uppercase">
        <span aria-hidden="true" className={`${dot} h-1.5 w-1.5 rounded-full`} />
        {label}
      </span>
      <span className="font-mono text-lg font-semibold" aria-label={`${label}: ${cents}% implied`}>
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
      className={`bg-paper text-ink relative flex flex-col rounded-lg px-4 pt-3 pb-3 shadow-[0_14px_34px_rgba(0,0,0,0.5)] ${className}`}
    >
      <div aria-hidden="true" className="h-1.5 -translate-y-1" style={perforationStyle} />

      {/* Muted labels on paper use ink-at-70% (not `text-muted`, which is tuned for the dark bg
          and fails AA on paper — caught by the SW8-T1 axe pass). */}
      <div className="text-ink/70 flex items-center justify-between font-mono text-[9px] font-semibold tracking-widest uppercase">
        <span>{eyebrow}</span>
        <span>{serial}</span>
      </div>

      <h2 className="font-display mt-2.5 text-2xl leading-[1.02] font-bold uppercase">
        {headline}
      </h2>

      <div dir="ltr" className="mt-auto flex gap-2 pt-4">
        {leftChip}
        {rightChip}
      </div>

      <div className="text-ink/70 mt-2 flex items-center justify-between font-mono text-[9px] tracking-wide uppercase">
        <span>{venue}</span>
        <span>{lockLabel}</span>
      </div>

      <div aria-hidden="true" className="h-1.5 translate-y-1" style={perforationStyle} />

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
      className={`bg-paper text-ink/70 flex flex-col rounded-lg px-4 pt-3 pb-3 ${className}`}
    >
      <div className="h-1.5 -translate-y-1" style={perforationStyle} />
      {label ? (
        <span className="font-mono text-[9px] font-semibold tracking-widest uppercase">
          {label}
        </span>
      ) : null}
      <div className="mt-auto h-1.5 translate-y-1" style={perforationStyle} />
    </div>
  );
}
