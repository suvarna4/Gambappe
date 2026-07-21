import { Stamp, TicketCard } from '@receipts/ui';

export interface ProfileStatGridProps {
  currentStreak: number;
  bestStreak: number;
  currentWinStreak: number;
  bestWinStreak: number;
  /** Glicko rating, already resolved — `null` when the profile has no rating row yet (renders `—`). */
  rating: number | null;
  nemesis: { wins: number; losses: number; draws: number };
  /** Derived badge slugs (§6.7) — only `called_it` is rendered today. */
  badges: readonly string[];
  /**
   * `/you` ghost (forming) state: the record isn't saved yet, so every stat renders a neutral `—`
   * placeholder and no badges show. Omitted on `/p/[slug]` and `/you` claimed → the real numbers.
   */
  forming?: boolean;
}

/**
 * The four-up profile stat card (streak · win streak · rating · nemesis record) plus the
 * `called it` stamp. Extracted from `/p/[slug]` (WS22-T1) so the public profile page and the
 * signed-in `/you` record room compose the SAME stat markup instead of forking it (journeys plan
 * §5 WS22-T1 AC). Presentational and viewer-free.
 */
export function ProfileStatGrid({
  currentStreak,
  bestStreak,
  currentWinStreak,
  bestWinStreak,
  rating,
  nemesis,
  badges,
  forming = false,
}: ProfileStatGridProps) {
  return (
    <TicketCard>
      <dl className="grid grid-cols-2 gap-4 font-mono text-sm sm:grid-cols-4">
        <div>
          <dt className="text-muted text-xs uppercase">Streak</dt>
          <dd>
            {forming ? (
              '—'
            ) : (
              <>
                {currentStreak} <span className="text-muted">(best {bestStreak})</span>
              </>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-muted text-xs uppercase">Win streak</dt>
          <dd>
            {forming ? (
              '—'
            ) : (
              <>
                {currentWinStreak} <span className="text-muted">(best {bestWinStreak})</span>
              </>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-muted text-xs uppercase">Rating</dt>
          <dd>{forming || rating === null ? '—' : Math.round(rating)}</dd>
        </div>
        <div>
          <dt className="text-muted text-xs uppercase">Nemesis record</dt>
          <dd>
            {forming ? '—' : `${nemesis.wins}-${nemesis.losses}-${nemesis.draws}`}
          </dd>
        </div>
      </dl>
      {!forming && badges.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {badges.includes('called_it') && <Stamp variant="called_it" />}
        </div>
      )}
    </TicketCard>
  );
}
