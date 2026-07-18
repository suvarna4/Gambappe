import { CountdownTicker, Stamp, TicketCard } from '@receipts/ui';
import { nemesisConcludeAt } from '@/lib/nemesis/clock';
import { sideOutcome } from '@/lib/nemesis/verdict';
import type { PairingPublic, PairingSide } from '@/lib/nemesis/types';
import { DrawBadge } from './DrawBadge';
import { NemesisScoreboard } from './NemesisScoreboard';

export interface NemesisMatchupCardProps {
  pairing: PairingPublic;
  /** Rating-augmented versions of `pairing.a`/`pairing.b` (composed from `GET /profiles/:slug`, see mock-api.ts). */
  sides: { a: PairingSide; b: PairingSide };
  /** Null for a spectator — renders both sides neutrally, no "You" substitution. */
  viewerProfileId: string | null;
  /** §9.1 `x-server-time` clock-offset convention, threaded down to `CountdownTicker`. */
  serverOffsetMs?: number;
  className?: string;
}

function SideBlock({
  side,
  isViewer,
  outcome,
}: {
  side: PairingSide;
  isViewer: boolean;
  outcome: 'pending' | 'cancelled' | 'win' | 'loss' | 'draw';
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-ink font-medium">{isViewer ? 'You' : side.handle}</span>
      {isViewer ? <span className="text-muted text-xs">{side.handle}</span> : null}
      {side.rating ? (
        <span
          className="font-mono text-xs"
          aria-label={`Glicko rating ${Math.round(side.rating.glicko_rating)}`}
        >
          {Math.round(side.rating.glicko_rating)}
          <span className="text-muted"> rating</span>
        </span>
      ) : null}
      {outcome === 'win' || outcome === 'loss' ? (
        <Stamp variant={outcome} />
      ) : outcome === 'draw' ? (
        <DrawBadge />
      ) : null}
    </div>
  );
}

/**
 * The public nemesis matchup card (design doc §19.3 WS7-T6: "matchup page"; §10.1 `/vs/[pairingId]`).
 * Pure/presentational per §10.4 — no fetching, no client-only hooks beyond what `CountdownTicker`
 * already needs; safe to render on the server (INV-10: identical output for every visitor when
 * `viewerProfileId` is null, which is what the server render must always pass).
 *
 * Per-side verdict stamps (`sideOutcome`, §19.3 AC "verdict card win AND loss variants") are
 * deliberately OBJECTIVE — computed from `winner_profile_id` vs. each side's own id, not
 * relative to `viewerProfileId`. A spectator viewing the public page with no identity at all
 * must still see who won; "You"-framing is a separate, purely cosmetic label swap.
 */
export function NemesisMatchupCard({
  pairing,
  sides,
  viewerProfileId,
  serverOffsetMs = 0,
  className = '',
}: NemesisMatchupCardProps) {
  const viewerSide: 'a' | 'b' | null =
    viewerProfileId === pairing.a.profile_id
      ? 'a'
      : viewerProfileId === pairing.b.profile_id
        ? 'b'
        : null;

  return (
    <TicketCard className={className}>
      <div className="flex items-start justify-between gap-4">
        <SideBlock
          side={sides.a}
          isViewer={viewerSide === 'a'}
          outcome={sideOutcome(pairing, pairing.a.profile_id)}
        />
        <div className="flex flex-col items-center gap-1">
          <span className="text-muted font-mono text-xs uppercase">vs</span>
          <span
            className="font-mono text-lg font-bold"
            aria-label={`Score ${pairing.score.a} to ${pairing.score.b}`}
          >
            {pairing.score.a}–{pairing.score.b}
          </span>
        </div>
        <div className="text-right">
          <SideBlock
            side={sides.b}
            isViewer={viewerSide === 'b'}
            outcome={sideOutcome(pairing, pairing.b.profile_id)}
          />
        </div>
      </div>

      {pairing.is_rematch ? (
        <p className="text-muted mt-2 text-xs uppercase tracking-wide">Rematch</p>
      ) : null}

      <div className="mt-3">
        {pairing.status === 'active' || pairing.status === 'scheduled' ? (
          <CountdownTicker
            targetIso={nemesisConcludeAt(pairing.week_start).toISOString()}
            serverOffsetMs={serverOffsetMs}
            label="Verdict in"
          />
        ) : pairing.status === 'cancelled' ? (
          <p className="text-muted text-sm">Pairing cancelled — no rating change.</p>
        ) : null}
        {pairing.narrative_line ? (
          <p className="text-ink mt-2 text-sm">{pairing.narrative_line}</p>
        ) : null}
      </div>

      {pairing.scoreboard.length > 0 ? (
        <NemesisScoreboard rows={pairing.scoreboard} viewerSide={viewerSide} className="mt-4" />
      ) : null}
    </TicketCard>
  );
}
