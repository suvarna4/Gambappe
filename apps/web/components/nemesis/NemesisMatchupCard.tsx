import { CountdownTicker, Stamp, TicketCard } from '@receipts/ui';
import type { PairingReactionEmoji, SameSide } from '@receipts/core';
import { nemesisConcludeAt } from '@/lib/nemesis/clock';
import { sideOutcome } from '@/lib/nemesis/verdict';
import type { PairingPublic, PairingSide } from '@/lib/nemesis/types';
import { DrawBadge } from './DrawBadge';
import { NemesisScoreboard } from './NemesisScoreboard';
import { ReactionStamps } from './ReactionStamps';
import { ReactionStampsPanel } from './ReactionStampsPanel';
import { SameSideState, type SameSideSettled } from './SameSideState';

export interface NemesisMatchupCardProps {
  pairing: PairingPublic;
  /** Rating-augmented versions of `pairing.a`/`pairing.b` (composed from `GET /profiles/:slug`, see mock-api.ts). */
  sides: { a: PairingSide; b: PairingSide };
  /** Null for a spectator — renders both sides neutrally, no "You" substitution. */
  viewerProfileId: string | null;
  /** §9.1 `x-server-time` clock-offset convention, threaded down to `CountdownTicker`. */
  serverOffsetMs?: number;
  /**
   * WS20-T2 (D-J4) · The viewer-relative same-side day result for THIS matchup's current reveal,
   * straight off the reveal payload's `viewer.nemesis_flip.same_side`. Non-null only on a same-side
   * day; opposite-side/solo days leave it null and this card renders exactly as before. Passed ONLY
   * from a viewer-scoped, post-reveal context — never from the ISR/spectator shell (which passes
   * `viewerProfileId={null}` and no `sameSide`), so the sealed opponent stays sealed pre-lock.
   */
  sameSide?: SameSide | null;
  /** Objective shared-pick outcome for the same-side day above (`null` pre-settle). */
  sameSideSettled?: SameSideSettled;
  className?: string;
}

function SideBlock({
  side,
  isViewer,
  outcome,
  stamp,
}: {
  side: PairingSide;
  isViewer: boolean;
  outcome: 'pending' | 'cancelled' | 'win' | 'loss' | 'draw';
  /** SW10-T4: this side's own preset stamp reaction for today, if any — viewer-free, public
   * per-player data (`pairing.today_reactions`), safe on the ISR render. Read-only here: this
   * is the "show both players' stamps" half of the feature; the viewer's own INTERACTIVE picker
   * is `ReactionStampsPanel`, mounted once, separately, below. */
  stamp: PairingReactionEmoji | null;
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
      {stamp ? <ReactionStamps selected={stamp} className="mt-1" /> : null}
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
 *
 * SW10-T4 (wiring-gaps doc §4): wires `ReactionStamps` in, split along the same read/write
 * lines the task pins. Read: each `SideBlock` renders that side's own today-stamp read-only,
 * straight off `pairing.today_reactions` — viewer-free, public, cache-safe (INV-10). Write: the
 * viewer's OWN interactive picker is `ReactionStampsPanel` (a client island, mounted once below,
 * same "self-fetch identity post-hydration" posture as `QuestionThread`/`ViewerStrip`) — it
 * derives `selected`/whether the viewer even CAN react entirely client-side, matching the
 * pairing's own `a`/`b` participant ids against the viewer's own `/me` profile id, so the
 * viewer's own stamp never appears in this component's SERVER render on EITHER page it mounts
 * on (`/vs/[pairingId]`'s ISR shell always passes `viewerProfileId={null}`; `/nemesis` is
 * `force-dynamic` with a real one, but this component still never computes `selected`
 * server-side — see `ReactionStampsPanel`'s own header for why that's true unconditionally).
 */
export function NemesisMatchupCard({
  pairing,
  sides,
  viewerProfileId,
  serverOffsetMs = 0,
  sameSide = null,
  sameSideSettled = null,
  className = '',
}: NemesisMatchupCardProps) {
  const viewerSide: 'a' | 'b' | null =
    viewerProfileId === pairing.a.profile_id
      ? 'a'
      : viewerProfileId === pairing.b.profile_id
        ? 'b'
        : null;
  // The rival is whichever side isn't the viewer's. `sameSide` is viewer-relative and only ever
  // arrives with a real viewer, so `viewerSide` is set here; fall back to side b defensively.
  const opponentHandle = viewerSide === 'a' ? sides.b.handle : sides.a.handle;

  return (
    <TicketCard className={className}>
      <div className="flex items-start justify-between gap-4">
        <SideBlock
          side={sides.a}
          isViewer={viewerSide === 'a'}
          outcome={sideOutcome(pairing, pairing.a.profile_id)}
          stamp={pairing.today_reactions?.a ?? null}
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
            stamp={pairing.today_reactions?.b ?? null}
          />
        </div>
      </div>

      {pairing.is_rematch ? (
        <p className="text-muted mt-2 text-xs uppercase tracking-wide">Rematch</p>
      ) : null}

      {/* WS20-T2 (D-J4): the same-side state — SAME SIDE tape + dual stamps + edge line. Renders
          only on a same-side day (non-null `sameSide`); opposite-side days skip it entirely and
          this card's markup stays byte-identical. On this paper card, so `surface="paper"`. */}
      {sameSide ? (
        <SameSideState
          sameSide={sameSide}
          opponentHandle={opponentHandle}
          settled={sameSideSettled}
          surface="paper"
          className="mt-3"
        />
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

      {/* SW10-T4: the viewer's own interactive stamp picker — a client island, entirely
          post-hydration (never server-rendered with real viewer state; see file header). */}
      <ReactionStampsPanel
        pairingId={pairing.id}
        sideProfileIds={{ a: pairing.a.profile_id, b: pairing.b.profile_id }}
        stamps={pairing.today_reactions ?? null}
        className="mt-3"
      />

      {pairing.scoreboard.length > 0 ? (
        <NemesisScoreboard rows={pairing.scoreboard} viewerSide={viewerSide} className="mt-4" />
      ) : null}
    </TicketCard>
  );
}
