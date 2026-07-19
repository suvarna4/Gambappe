import Link from 'next/link';
import type { z } from 'zod';
import type { duoPublicSchema } from '@receipts/core';
import { TicketCard } from '@receipts/ui';
import { duoCopy, duoTierLabel } from '@/lib/copy';

export type DuoPublic = z.infer<typeof duoPublicSchema>;

export interface DuoCardProps {
  duo: DuoPublic;
  /** Renders partner handles as links to their public profile (`/p/[slug]`, §10.1) — the
   * public `/duos/[id]` page wants this; the compact hub summary passes `false` to keep the
   * partner name plain text next to a "View your duo" link instead (avoids two overlapping
   * link targets in a small card). */
  linkPartners?: boolean;
  className?: string;
}

/**
 * The full duo detail card (design doc §9.2 `GET /duos/:id`: "partners, tier, rating,
 * chemistry"; §19.3 WS7-T7). Pure/presentational per §10.4 — no fetching — so it renders
 * identically on the public ISR page (INV-10) and, in compact contexts, reused pieces of it
 * elsewhere. `duo.status === 'disbanded'` still renders fully (`serialize-duo.ts`'s header:
 * "a disbanded duo still resolves... exactly what disband... leaves behind").
 */
export function DuoCard({ duo, linkPartners = true, className = '' }: DuoCardProps) {
  const [a, b] = duo.partners;
  const jointHitRatePct =
    duo.joint_hit_rate !== null ? Math.round(duo.joint_hit_rate * 100) : null;

  return (
    <TicketCard className={className}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2 text-lg font-medium">
          {[a, b].map((partner, i) => (
            <span key={partner.profile_id} className="flex items-center gap-2">
              {linkPartners ? (
                <Link href={`/p/${partner.slug}`} className="underline underline-offset-2">
                  {partner.handle}
                </Link>
              ) : (
                <span>{partner.handle}</span>
              )}
              {i === 0 ? <span className="text-muted text-sm font-normal">&amp;</span> : null}
            </span>
          ))}
        </div>
        {duo.status === 'disbanded' ? (
          <span className="text-muted text-xs font-semibold uppercase tracking-wide">
            Disbanded
          </span>
        ) : null}
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-4 font-mono text-sm sm:grid-cols-3">
        <div>
          <dt className="text-muted text-xs uppercase">Tier</dt>
          <dd>{duoTierLabel(duo.tier)}</dd>
        </div>
        <div>
          <dt className="text-muted text-xs uppercase">{duoCopy.ratingLabel}</dt>
          <dd>{Math.round(duo.rating.glicko_rating)}</dd>
        </div>
        <div>
          <dt className="text-muted text-xs uppercase">{duoCopy.matchesPlayedLabel}</dt>
          <dd>{duo.matches_played}</dd>
        </div>
      </dl>

      <p className="text-muted mt-3 text-sm">
        {jointHitRatePct !== null && duo.synergy !== null
          ? duoCopy.chemistryLine(jointHitRatePct, duo.synergy)
          : duoCopy.chemistryPending}
      </p>
    </TicketCard>
  );
}
