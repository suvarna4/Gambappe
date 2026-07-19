import type { z } from 'zod';
import type { duoMatchPublicSchema } from '@receipts/core';
import { Stamp } from '@receipts/ui';
import { DrawBadge } from '@/components/nemesis/DrawBadge';
import { duoCopy } from '@/lib/copy';

export type DuoMatchPublic = z.infer<typeof duoMatchPublicSchema>;

export interface DuoMatchHistoryListProps {
  /** The viewing duo's own id — determines the win/loss framing per row. Pass the OTHER
   * duo's id (or omit) on a page with no "home" duo to render neutrally (score only, no
   * stamp) — not needed by this task's pages (both `/duos/[id]` and the hub always have a
   * home duo) but keeps the component honest about what it assumes. */
  duoId: string;
  matches: DuoMatchPublic[];
  className?: string;
}

/** §9.2 `GET /duos/:id` `match_history`: `completed`/`cancelled` only (`listDuoMatchHistory`'s
 * header) — a `cancelled` match has no `winner_duo_id` and gets no stamp, matching the design
 * doc's "no rating change" framing for cancelled pairings/matches elsewhere (§7.6-equivalent
 * for duos). A `completed` match with `winner_duo_id === null` is a draw (§8.9: "tie → higher
 * Σ edge... |Δedge| < 1e-4 → draw"). */
function outcomeFor(match: DuoMatchPublic, duoId: string): 'win' | 'loss' | 'draw' | 'cancelled' {
  if (match.status === 'cancelled') return 'cancelled';
  if (match.winner_duo_id === null) return 'draw';
  return match.winner_duo_id === duoId ? 'win' : 'loss';
}

function OutcomeBadge({ outcome }: { outcome: ReturnType<typeof outcomeFor> }) {
  if (outcome === 'win' || outcome === 'loss') return <Stamp variant={outcome} />;
  if (outcome === 'cancelled') {
    return <span className="text-muted text-xs uppercase">Cancelled</span>;
  }
  return <DrawBadge />;
}

/**
 * A duo's past matches (design doc §9.2 `GET /duos/:id` `match_history`; §19.3 WS7-T7 "match
 * history"). Pure/presentational per §10.4.
 */
export function DuoMatchHistoryList({ duoId, matches, className = '' }: DuoMatchHistoryListProps) {
  if (matches.length === 0) {
    return <p className={`text-muted text-sm ${className}`}>{duoCopy.historyEmpty}</p>;
  }
  return (
    <ul className={`divide-surface divide-y ${className}`}>
      {matches.map((match) => {
        const isA = match.duo_a_id === duoId;
        const own = isA ? match.score.a : match.score.b;
        const opp = isA ? match.score.b : match.score.a;
        return (
          <li key={match.id} className="flex items-center justify-between gap-4 py-3">
            <p className="text-muted font-mono text-xs">
              {match.window_start} – {match.window_end}
            </p>
            <p className="font-mono text-lg font-bold" aria-label={`Score ${own} to ${opp}`}>
              {own}–{opp}
            </p>
            <OutcomeBadge outcome={outcomeFor(match, duoId)} />
          </li>
        );
      })}
    </ul>
  );
}
