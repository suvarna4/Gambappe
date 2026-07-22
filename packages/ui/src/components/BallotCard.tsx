import type { ReactNode } from 'react';

import { impliedCents, type MarketSide } from '../format.js';
import { sideAxisPair } from '../side-axis.js';
import { TicketFrame } from './TicketFrame.js';

interface SidePriceProps {
  side: MarketSide;
  label: string;
  yesProbability: number;
}

/**
 * One side's printed price — a DISPLAY chip, not a control (the tap wells below the card are the
 * only pick buttons). Deliberately flat: no border box, so it never reads as a second, tappable
 * set of yes/no buttons alongside the wells. Side identity is carried by the colored dot (a UI
 * element, AA at 3:1); the label + cents stay in `ink` on paper (AA at 4.5:1) because the side
 * hues #3B82F6 / #F97316 fail AA as text on paper. `data-side` anchors the axis-order tests.
 */
function SidePrice({ side, label, yesProbability }: SidePriceProps) {
  const cents = impliedCents(side, yesProbability);
  const dot = side === 'yes' ? 'bg-side-a' : 'bg-side-b';
  return (
    <div data-side={side} className="text-ink flex flex-1 flex-col gap-0.5">
      <span className="flex items-center gap-1.5 font-mono text-[10px] font-semibold tracking-wider uppercase">
        <span aria-hidden="true" className={`${dot} h-1.5 w-1.5 rounded-full`} />
        {label}
      </span>
      <span
        className="text-ink/90 font-mono text-base font-semibold"
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
 * WS16-T3: composes `TicketFrame` (journeys-plan §2, D-J1) — the eyebrow/serial kicker is now
 * the frame's ADMIT-ONE header and the perforated top/bottom edges come from the frame, so no
 * perforation/admit CSS lives in this file anymore. The overlay is forwarded to the frame's
 * overlay slot, which anchors to the frame's outer (positioned) container exactly as the old
 * root did.
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
    <TicketFrame
      perf="both"
      header={{ left: eyebrow, right: serial }}
      overlay={overlay}
      className={`shadow-[0_14px_34px_rgba(0,0,0,0.5)] ${className}`}
    >
      <h2 className="font-display text-2xl leading-[1.02] font-bold uppercase">{headline}</h2>

      <div dir="ltr" className="mt-auto flex gap-2 pt-4">
        {leftChip}
        {rightChip}
      </div>

      {/* Muted labels on paper use ink-at-70% (not `text-muted`, which is tuned for the dark bg
          and fails AA on paper — caught by the SW8-T1 axe pass). */}
      <div className="text-ink/70 mt-2 flex items-center justify-between font-mono text-[9px] tracking-wide uppercase">
        <span>{venue}</span>
        <span>{lockLabel}</span>
      </div>
    </TicketFrame>
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
 * WS16-T3: composes `TicketFrame` (perforated both edges) so the perforation CSS lives only in
 * the frame. `TicketFrame` deliberately omits `position` when it has no notches/overlay (see its
 * own comment), so this card's documented "no base position" requirement is preserved — every
 * real caller (`DeckStage`, `SwipeBallot`, `/dev/ui`'s `gallery-ballotcard` tile) still owns
 * `position` via `className` (`absolute inset-x-3 -top-3 scale-95`) and it wins.
 */
export function UnderCard({ label, className = '' }: UnderCardProps) {
  return (
    <TicketFrame perf="both" ariaHidden className={className}>
      {label ? (
        <span className="text-ink/70 font-mono text-[9px] font-semibold tracking-widest uppercase">
          {label}
        </span>
      ) : null}
    </TicketFrame>
  );
}
