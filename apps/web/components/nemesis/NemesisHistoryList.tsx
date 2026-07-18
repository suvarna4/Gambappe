import Link from 'next/link';
import { Stamp } from '@receipts/ui';
import { nemesisCopy } from '@/lib/copy';
import type { NemesisHistoryEntry } from '@/lib/nemesis/types';
import { DrawBadge } from './DrawBadge';
import { RematchPanel } from './RematchPanel';

export interface NemesisHistoryListProps {
  viewerProfileId: string;
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
 * deliverable "history"). Each row offers a rematch request against that past opponent
 * (§8.4 step 0) via `RematchPanel`.
 */
export function NemesisHistoryList({
  viewerProfileId,
  entries,
  className = '',
}: NemesisHistoryListProps) {
  if (entries.length === 0) {
    return <p className={`text-muted text-sm ${className}`}>{nemesisCopy.historyEmpty}</p>;
  }
  return (
    <ul className={`divide-surface divide-y ${className}`}>
      {entries.map((entry) => (
        <li key={entry.pairing_id} className="flex items-center justify-between gap-4 py-3">
          <div>
            <Link
              href={`/vs/${entry.pairing_id}`}
              className="font-medium underline underline-offset-2"
            >
              {entry.opponent.handle}
            </Link>
            <p className="text-muted font-mono text-xs">
              {entry.my_score}–{entry.their_score} · week of {entry.week_start}
              {entry.is_rematch ? ' · rematch' : ''}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <OutcomeBadge outcome={entry.outcome} />
            <RematchPanel viewerProfileId={viewerProfileId} opponent={entry.opponent} />
          </div>
        </li>
      ))}
    </ul>
  );
}
