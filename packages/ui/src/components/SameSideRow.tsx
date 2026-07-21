import type { ReactNode } from 'react';

export interface SameSideEntry {
  /** Who this side belongs to — "YOU" or a rival handle. */
  owner: ReactNode;
  /** Mono caption under the owner, e.g. the entry price "@ 71¢" or "YES · 71¢". */
  caption: ReactNode;
  /** The pick/outcome mark for this side — caller supplies a `<Stamp />` (any variant/ink). */
  stamp: ReactNode;
}

export interface SameSideRowProps {
  left: SameSideEntry;
  right: SameSideEntry;
  className?: string;
}

/**
 * WS16-T3 · `SameSideRow` — two `Stamp`s side by side with owner + mono captions, split by the
 * ticket edge line (journeys-plan §2, D-J4). The visual for "both rivals took the same side —
 * edge decides": each column shows whose pick it is, its stamped mark, and the price caption,
 * with a dashed tear-line down the middle echoing the perforation. Consumed by the nemesis
 * matchup rows and the settle receipt (WS20-T2). Presentational: the caller supplies the two
 * `<Stamp />` elements (so it stays decoupled from stamp variants) and the price strings.
 */
function Column({ entry, align }: { entry: SameSideEntry; align: 'left' | 'right' }) {
  const items = align === 'left' ? 'items-start' : 'items-end';
  return (
    <div className={`flex flex-1 flex-col gap-1 ${items}`}>
      <span className="font-mono text-[10px] font-semibold tracking-wider uppercase opacity-80">
        {entry.owner}
      </span>
      {entry.stamp}
      <span className="font-mono text-xs">{entry.caption}</span>
    </div>
  );
}

export function SameSideRow({ left, right, className = '' }: SameSideRowProps) {
  return (
    <div data-testid="same-side-row" className={`flex items-stretch gap-3 ${className}`}>
      <Column entry={left} align="left" />
      {/* The ticket edge line: a dashed tear down the middle, same motif as the perforation. */}
      <span aria-hidden="true" className="border-l border-dashed border-ink/25 self-stretch" />
      <Column entry={right} align="right" />
    </div>
  );
}
