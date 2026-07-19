import { sideAxisPair } from '@receipts/ui';
import { nemesisCopy } from '@/lib/copy';

export type VerdictOutcome = 'won' | 'lost' | 'drew';

export interface VerdictCardProps {
  outcome: VerdictOutcome;
  opponentHandle: string;
  youWins: number;
  opponentWins: number;
  /** Points of edge the winner led by — powers the loser card's richer line (P3). */
  edgeGap: number;
  /** Per-day results, viewer-relative, for the week strip. */
  dayResults: ReadonlyArray<'win' | 'loss' | 'split' | 'pending'>;
  /** The week's closing swipe (rematch-by-swipe): right = run it back, left = new fate. Omit for
   * a static/spectator card. */
  onRunItBack?: () => void;
  onNewFate?: () => void;
  className?: string;
}

const DOT: Record<string, string> = {
  win: 'bg-win border-win',
  loss: 'bg-loss border-loss',
  split: 'bg-muted border-muted',
  pending: 'border-muted',
};

/**
 * SW5-T2 · The Friday nemesis verdict card (swipe-ux-plan §2.9, P3). Both players get one; the
 * loser's carries the richer, funnier line. The week's closing decision is a throw —
 * `Run it back` (right, affirmative per D-SW9) requests the rematch, `New fate` (left) lets the
 * engine deal a new stranger. Those two are the accessible axis-ordered controls; a
 * `SwipeBallot variant="verdict"` wraps them as the gesture in the DB-equipped session (the
 * buttons remain the keyboard/AT path either way). Presentational: omit the handlers for the
 * public spectator card.
 */
export function VerdictCard({
  outcome,
  opponentHandle,
  youWins,
  opponentWins,
  edgeGap,
  dayResults,
  onRunItBack,
  onNewFate,
  className = '',
}: VerdictCardProps) {
  const heading =
    outcome === 'won'
      ? nemesisCopy.verdictWon
      : outcome === 'lost'
        ? nemesisCopy.verdictLost
        : nemesisCopy.verdictDrew;
  const line =
    outcome === 'lost'
      ? nemesisCopy.verdictLoserLine(opponentHandle, edgeGap)
      : nemesisCopy.verdictWinnerLine(opponentHandle);
  const interactive = Boolean(onRunItBack || onNewFate);

  const [leftAction, rightAction] = sideAxisPair(
    onNewFate ? (
      <button
        key="new-fate"
        type="button"
        data-testid="verdict-new-fate"
        onClick={onNewFate}
        className="text-muted min-h-11 flex-1 rounded-lg border font-display text-sm font-bold tracking-wide uppercase"
      >
        {nemesisCopy.newFate}
      </button>
    ) : null,
    onRunItBack ? (
      <button
        key="run-it-back"
        type="button"
        data-testid="verdict-run-it-back"
        onClick={onRunItBack}
        className="border-gold text-gold min-h-11 flex-1 rounded-lg border font-display text-sm font-bold tracking-wide uppercase"
      >
        {nemesisCopy.runItBack}
      </button>
    ) : null,
  );

  return (
    <div data-testid="verdict-card" data-outcome={outcome} className={`space-y-3 ${className}`}>
      <div className="bg-paper text-ink relative flex flex-col gap-2 rounded-lg px-4 py-4 shadow-[0_14px_34px_rgba(0,0,0,0.5)]">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-2xl leading-none font-bold uppercase">{heading}</h2>
          <span className="font-mono text-lg font-semibold">
            {nemesisCopy.verdictScore(youWins, opponentWins)}
          </span>
        </div>

        <div dir="ltr" className="flex items-center gap-1.5" aria-hidden="true">
          {dayResults.map((r, i) => (
            <span key={i} className={`h-2.5 w-2.5 rounded-full border ${DOT[r] ?? DOT.pending}`} />
          ))}
        </div>

        <p className="text-ink/70 font-mono text-[11px] leading-relaxed">{line}</p>
      </div>

      {interactive ? (
        <div dir="ltr" className="flex gap-2">
          {leftAction}
          {rightAction}
        </div>
      ) : null}
    </div>
  );
}
