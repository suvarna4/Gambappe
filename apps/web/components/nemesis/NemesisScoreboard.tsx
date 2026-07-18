import { Stamp } from '@receipts/ui';
import type { PairingScoreboardRow } from '@/lib/nemesis/types';

export interface NemesisScoreboardProps {
  rows: PairingScoreboardRow[];
  /** Which side (`a`/`b`) is the viewer's, so their column can render first/highlighted. Null for spectators. */
  viewerSide: 'a' | 'b' | null;
  className?: string;
}

function rowLabel(row: PairingScoreboardRow): string {
  if (row.kind === 'nemesis_bonus') return 'Bonus question';
  return row.question_date ?? row.slug;
}

/**
 * One side's cell in the scoreboard. `pick` is `null` for BOTH "masked pre-lock" and
 * "no pick made" (§9.3) — the public contract doesn't distinguish them, so neither does
 * this UI (see `mock-api.ts` SPEC-GAP header for why). `question_date` lets us guess which
 * case is more likely (upcoming date → probably masked) without ever claiming certainty.
 */
function ScoreCell({
  pick,
  questionDate,
}: {
  pick: PairingScoreboardRow['a'];
  questionDate: string | null;
}) {
  if (pick === null) {
    const hint = questionDate ? `Locks ${questionDate}` : 'Not yet locked';
    return (
      <span className="text-muted font-mono text-xs" aria-label={`Hidden — ${hint}`}>
        · · ·
      </span>
    );
  }
  if (pick.result === 'pending' || pick.result === null) {
    return <span className="text-muted font-mono text-xs uppercase">picked</span>;
  }
  return <Stamp variant={pick.result} className="text-xs" />;
}

/**
 * The shared-question-by-shared-question scoreboard for a nemesis pairing (§8.8). Masking
 * (§9.3) is already applied server-side (`toScoreboardRow`, or the real WS5-T4 handler) —
 * this component just renders whatever it's given; it never decides what to hide.
 */
export function NemesisScoreboard({ rows, viewerSide, className = '' }: NemesisScoreboardProps) {
  const [firstKey, secondKey]: ['a' | 'b', 'a' | 'b'] =
    viewerSide === 'b' ? ['b', 'a'] : ['a', 'b'];
  return (
    <table className={`w-full text-left ${className}`}>
      <thead>
        <tr className="text-muted text-xs uppercase">
          <th className="pb-2 font-medium">Question</th>
          <th className="pb-2 font-medium">{firstKey === viewerSide ? 'You' : 'A'}</th>
          <th className="pb-2 font-medium">{secondKey === viewerSide ? 'You' : 'B'}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.question_id} className="border-surface border-t">
            <td className="py-2 pr-2 font-mono text-xs">{rowLabel(row)}</td>
            <td className="py-2 pr-2">
              <ScoreCell pick={row[firstKey]} questionDate={row.question_date} />
            </td>
            <td className="py-2">
              <ScoreCell pick={row[secondKey]} questionDate={row.question_date} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
