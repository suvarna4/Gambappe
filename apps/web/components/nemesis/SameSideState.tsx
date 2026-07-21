import type { ReactNode } from 'react';
import { SameSideRow, Stamp, TapeLabel } from '@receipts/ui';
import type { SameSide } from '@receipts/core';
import { sameSideCopy } from '@/lib/copy';

/** Objective shared-pick outcome once the day settles. Both rivals took the SAME side, so they
 * share ONE outcome — there is no "one right, one wrong" state here. `null` (or omitted) means the
 * day is not yet graded → the pre-settle price-edge footer. */
export type SameSideSettled = 'both_right' | 'both_wrong' | null;

export interface SameSideStateProps {
  /** Viewer-relative same-side day result — straight off the reveal payload's
   * `viewer.nemesis_flip.same_side` (`@receipts/core`'s `SameSide`, integer implied-entry cents). */
  sameSide: SameSide;
  /** The rival's handle, for the right-hand owner caption. */
  opponentHandle: ReactNode;
  /** See `SameSideSettled` — omit/pass null pre-settle. */
  settled?: SameSideSettled;
  /** `'paper'` (default) inside the paper cards, `'stage'` on the dark `bg-bg` deck/gallery. Only
   * governs the caption/footer text ink — the stamps and `TapeLabel` carry their own treatment and
   * read on both grounds (WS20-T2 a11y AC: `text-paper`/`text-muted` are AA on `bg`, `text-ink`
   * only ever inside a paper surface). */
  surface?: 'paper' | 'stage';
  className?: string;
}

/**
 * WS20-T2 (journeys-plan §5, D-J4) · The same-side card state, shared by `NemesisMatchupCard` and
 * `VerdictCard` so the two surfaces can never render it differently. When rivals took the SAME
 * side, the day is decided by price edge (D-J4): the cheaper entry wins, or — if both were wrong —
 * the smaller implied loss wins. Purely presentational.
 *
 * Both columns carry the SAME stamp variant (same side ⇒ same objective outcome); the edge winner
 * is named only in the footer copy and the two price captions, never by a louder/gold stamp
 * (D-SW1: gold is for `called_it`/wins alone — a same-side edge win is not a gold affordance).
 *
 * SEAL SAFETY (WS20-T2 AC): this renders only when a caller passes a non-null `sameSide`. That data
 * lives ONLY on the viewer-scoped, client-fetched reveal payload (`nemesis_flip.same_side`, §10.2)
 * — never on the ISR-cached viewer-free pairing shell — so the ISR/spectator renders of
 * `NemesisMatchupCard` (`/vs/[pairingId]`, `viewerProfileId={null}`) pass nothing and stay
 * byte-identical to today's opposite-side behavior; there is nothing here to leak pre-lock.
 */
export function SameSideState({
  sameSide,
  opponentHandle,
  settled = null,
  surface = 'paper',
  className = '',
}: SameSideStateProps) {
  const { your_price, their_price, winner } = sameSide;
  const stampVariant =
    settled === 'both_right' ? 'win' : settled === 'both_wrong' ? 'loss' : 'pending';
  const footer =
    settled === 'both_right'
      ? sameSideCopy.bothRight(winner)
      : settled === 'both_wrong'
        ? sameSideCopy.bothWrong(winner)
        : sameSideCopy.priceEdge(your_price, their_price);
  const bodyTone = surface === 'stage' ? 'text-paper' : 'text-ink';
  const footerTone = surface === 'stage' ? 'text-muted' : 'text-ink/70';

  return (
    <div data-testid="same-side-state" className={`${bodyTone} space-y-2 ${className}`}>
      <TapeLabel tilt={false}>{sameSideCopy.tape}</TapeLabel>
      <SameSideRow
        left={{
          owner: sameSideCopy.youOwner,
          caption: sameSideCopy.priceCaption(your_price),
          stamp: <Stamp variant={stampVariant} />,
        }}
        right={{
          owner: opponentHandle,
          caption: sameSideCopy.priceCaption(their_price),
          stamp: <Stamp variant={stampVariant} />,
        }}
      />
      <p className={`${footerTone} font-mono text-[11px] tracking-wide uppercase`}>{footer}</p>
    </div>
  );
}
