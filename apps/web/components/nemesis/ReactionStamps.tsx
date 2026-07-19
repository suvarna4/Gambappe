'use client';

import { nemesisCopy } from '@/lib/copy';

export type ReactionStamp = (typeof nemesisCopy.reactionStamps)[number];

export interface ReactionStampsProps {
  /** The viewer's current reaction for today, if any (one per player per day, §2.9). */
  selected?: ReactionStamp | null;
  /** Omit for a read-only view (ghosts see but can't send — the claim prompt handles that). */
  onSelect?: (stamp: ReactionStamp) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * SW5-T4 · Preset stamp reactions (swipe-ux-plan §2.9): the matchup "trash talk", rendered as
 * rotated rubber-stamp chips. Preset-only — there is no free-text input anywhere (P1), so the set
 * is fixed and block/report-safe. One selection per player per day; the caller enforces the daily
 * cap and gates sending behind a claimed account. Ghosts get a read-only view (`onSelect`
 * omitted). Wiring to the reactions API lives in the DB-equipped session.
 */
export function ReactionStamps({
  selected = null,
  onSelect,
  disabled = false,
  className = '',
}: ReactionStampsProps) {
  const readOnly = !onSelect;
  return (
    <div
      data-testid="reaction-stamps"
      className={`flex flex-wrap gap-2 ${className}`}
      role={readOnly ? undefined : 'group'}
      aria-label={readOnly ? undefined : 'React with a stamp'}
    >
      {nemesisCopy.reactionStamps.map((stamp) => {
        const isSelected = selected === stamp;
        const chipClass = `font-display text-[11px] font-bold tracking-wide uppercase -rotate-2 rounded border-2 px-2.5 py-0.5 ${
          isSelected ? 'border-gold text-gold' : 'border-muted text-muted'
        }`;
        if (readOnly) {
          return (
            <span key={stamp} data-testid={`reaction-${stamp}`} className={chipClass}>
              {stamp}
            </span>
          );
        }
        return (
          <button
            key={stamp}
            type="button"
            data-testid={`reaction-${stamp}`}
            aria-pressed={isSelected}
            disabled={disabled}
            onClick={() => onSelect(stamp)}
            className={`${chipClass} disabled:opacity-50`}
          >
            {stamp}
          </button>
        );
      })}
    </div>
  );
}
