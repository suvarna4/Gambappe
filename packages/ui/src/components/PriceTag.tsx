import type { MarketSide } from '../format.js';
import { impliedCents } from '../format.js';

export interface PriceTagProps {
  side: MarketSide;
  label: string;
  yesProbability: number;
  className?: string;
}

/**
 * §10.4 PriceTag: printed entry price ("YES @ 63¢"). This is cents-of-probability
 * (standard prediction-market notation), never a money amount (INV-1/7) — the a11y
 * label says so explicitly. Carries `data-side` so axis-pair call sites can prove
 * D-SW9 DOM order (NO left, YES right — swipe plan §2.2) in unit tests.
 */
export function PriceTag({ side, label, yesProbability, className = '' }: PriceTagProps) {
  const cents = impliedCents(side, yesProbability);
  // On-paper side ink (this motif is always on paper — note the `text-ink` label + a11y label):
  // the bright side tokens fail AA as text on cream, so darken them (~6:1). Caught by SW8-T1's
  // axe pass over the design-system gallery; the pre-existing bright values regressed AA on `/q`.
  const accentClass = side === 'yes' ? 'text-[#1d4fa8]' : 'text-[#b34d0a]';
  return (
    <span
      data-side={side}
      className={`font-mono ${accentClass} inline-flex items-baseline gap-1.5 text-sm ${className}`}
      aria-label={`${cents}% implied`}
    >
      <span className="text-ink font-sans font-medium uppercase">{label}</span>
      <span>@ {cents}¢</span>
    </span>
  );
}
