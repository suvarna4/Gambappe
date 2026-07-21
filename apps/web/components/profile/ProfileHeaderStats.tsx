import { StreakFlame } from '@receipts/ui';
import { topPercentDisplay } from './format';

export interface ProfileHeaderStatsProps {
  /** Current daily streak (the headline number the flame shows). */
  currentStreak: number;
  /** Freeze bank — a `0`-streak with banked freezes renders the flame in its frozen state. */
  freezeBank: number;
  /** Public accuracy percentile (§9.2) — `null` when the profile has no rating yet. */
  accuracyPercentile: number | null;
  /** WS12 verified-wallet badge presence. */
  walletVerified: boolean;
  /**
   * `/you` only: append the streak-freeze note (`N freezes banked`) next to the flame. Omitted on
   * `/p/[slug]`, which renders byte-identically to its pre-extraction markup.
   */
  freezeNote?: boolean;
}

/**
 * The profile header stat row — the streak flame plus the accuracy / verified-wallet captions.
 * Extracted from `/p/[slug]` (WS22-T1) so both the public profile page and the signed-in `/you`
 * record room share ONE stat header rather than forking the markup (journeys plan §5 WS22-T1 AC).
 * Presentational and viewer-free — the caller supplies already-resolved numbers.
 */
export function ProfileHeaderStats({
  currentStreak,
  freezeBank,
  accuracyPercentile,
  walletVerified,
  freezeNote = false,
}: ProfileHeaderStatsProps) {
  return (
    <div className="flex flex-wrap items-center gap-4">
      <StreakFlame count={currentStreak} frozen={currentStreak === 0 && freezeBank > 0} />
      {accuracyPercentile != null && (
        <span className="text-muted font-mono text-sm">
          {topPercentDisplay(accuracyPercentile)} accuracy
        </span>
      )}
      {walletVerified && <span className="text-muted text-sm">verified wallet</span>}
      {freezeNote && freezeBank > 0 && (
        <span className="text-muted font-mono text-xs" data-testid="profile-freeze-note">
          {freezeBank} {freezeBank === 1 ? 'freeze' : 'freezes'} banked
        </span>
      )}
    </div>
  );
}
