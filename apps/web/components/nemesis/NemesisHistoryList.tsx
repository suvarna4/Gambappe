import Link from 'next/link';
import { Stamp } from '@receipts/ui';
import { nemesisCopy } from '@/lib/copy';
import type { NemesisHistoryEntry } from '@/lib/nemesis/types';
import { DrawBadge } from './DrawBadge';

export interface NemesisHistoryListProps {
  entries: NemesisHistoryEntry[];
  className?: string;
}

function OutcomeBadge({ outcome }: { outcome: NemesisHistoryEntry['outcome'] }) {
  if (outcome === 'win' || outcome === 'loss') return <Stamp variant={outcome} />;
  if (outcome === 'draw') return <DrawBadge />;
  return <span className="text-muted text-xs uppercase">Cancelled</span>;
}

/**
 * Lifetime nemesis history (design doc §9.2 `GET /me/nemesis-history`; §19.3 WS7-T6
 * deliverable "history"), now living at its own `/nemesis/history` route (design-diff audit,
 * see that page's header). A plain, compact past-record list — no head-to-head banner, no
 * verdict swipe card, no rematch-request affordance: those all belong to the CURRENT week's
 * actionable verdict on `/nemesis` itself. Explicit design feedback on an earlier version of
 * this route (which reused the banner + swipeable `RematchPanel` per row) was that every row
 * rendered far too large, and that history is a read-only record — "no option to pick new
 * fate/run it back" here. Each row is just the opponent, the score, the week, and the outcome
 * badge.
 */
export function NemesisHistoryList({ entries, className = '' }: NemesisHistoryListProps) {
  if (entries.length === 0) {
    return <p className={`text-muted text-sm ${className}`}>{nemesisCopy.historyEmpty}</p>;
  }
  return (
    <ul className={`divide-surface divide-y ${className}`}>
      {entries.map((entry) => (
        <li key={entry.pairing_id} className="flex items-center justify-between gap-4 py-3">
          <div>
            <Link href={`/vs/${entry.pairing_id}`} className="font-medium underline underline-offset-2">
              {entry.opponent.handle}
            </Link>
            <p className="text-muted font-mono text-xs">
              {entry.my_score}–{entry.their_score} · week of {entry.week_start}
              {entry.is_rematch ? ' · rematch' : ''}
            </p>
          </div>
          <OutcomeBadge outcome={entry.outcome} />
        </li>
      ))}
    </ul>
  );
}
