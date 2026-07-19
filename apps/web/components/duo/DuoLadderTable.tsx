import Link from 'next/link';
import type { z } from 'zod';
import type { ladderEntrySchema } from '@receipts/core';
import { duoCopy, duoTierLabel } from '@/lib/copy';

export type DuoLadderEntry = z.infer<typeof ladderEntrySchema>;

export interface DuoLadderTableProps {
  entries: DuoLadderEntry[];
  /** Highlights the row matching this duo id (e.g. the viewer's own duo, from the hub's "view
   * the ladder" link) — purely cosmetic, no behavior change. */
  highlightDuoId?: string | null;
  className?: string;
}

/**
 * Tier standings (design doc §8.10, §9.2 `GET /duo/ladder`: "tier standings, paginated";
 * §19.3 WS7-T7 "ladder view with tier/pagination"). Pure/presentational per §10.4 — the page
 * component owns fetching + cursor state, this just renders one page of ranked entries.
 */
export function DuoLadderTable({ entries, highlightDuoId = null, className = '' }: DuoLadderTableProps) {
  if (entries.length === 0) {
    return <p className={`text-muted text-sm ${className}`}>{duoCopy.ladderEmpty}</p>;
  }
  return (
    <table className={`w-full text-left ${className}`}>
      <thead>
        <tr className="text-muted text-xs uppercase">
          <th className="pb-2 pr-2 font-medium">#</th>
          <th className="pb-2 pr-2 font-medium">{duoCopy.ladderTierColumn}</th>
          <th className="pb-2 pr-2 font-medium">{duoCopy.ladderDuoColumn}</th>
          <th className="pb-2 pr-2 font-medium">{duoCopy.ladderWinsColumn}</th>
          <th className="pb-2 font-medium">{duoCopy.ladderRatingColumn}</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => {
          const [a, b] = entry.duo.partners;
          const isHighlighted = highlightDuoId != null && entry.duo.id === highlightDuoId;
          return (
            <tr
              key={entry.duo.id}
              className={`border-surface border-t ${isHighlighted ? 'bg-surface' : ''}`}
            >
              <td className="py-2 pr-2 font-mono text-xs">{entry.rank}</td>
              <td className="py-2 pr-2 font-mono text-xs">{duoTierLabel(entry.tier)}</td>
              <td className="py-2 pr-2 text-sm">
                <Link href={`/duos/${entry.duo.id}`} className="underline underline-offset-2">
                  {a.handle} &amp; {b.handle}
                </Link>
              </td>
              <td className="py-2 pr-2 font-mono text-xs">{entry.wins}</td>
              <td className="py-2 font-mono text-xs">{Math.round(entry.duo.rating.glicko_rating)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
