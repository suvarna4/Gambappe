import { obituaryCopy } from '@/lib/copy';

export interface GraveyardShelfProps {
  /** Lengths of past broken streaks, most recent first — each becomes a "RIP {n}" headstone. */
  ripDays: number[];
  /** Lifetime count of longshot "Called it" badges, shown beside the graves (the trophies). */
  calledItCount: number;
  className?: string;
}

/**
 * SW4-T3 · The graveyard shelf on the profile page (swipe-ux-plan §2.7, P3): past broken streaks
 * as headstones sitting beside the "Called it" trophies — the losses and the wins on one shelf,
 * on purpose. Presentational.
 *
 * SPEC-GAP(SW4-T3): `ProfilePublic` (packages/core §9.2) exposes `streak.{current,best}` but no
 * broken-streak history, so there is no data source for `ripDays` yet. The DB-equipped session
 * wires this once a streak-history read exists (a small additive endpoint over the pick log);
 * until then the profile page renders it only when history is supplied, and the empty state is
 * the honest default. This component takes the data as a prop so it's ready the moment that read
 * lands — same build-then-wire split as the SP2 cards.
 */
export function GraveyardShelf({ ripDays, calledItCount, className = '' }: GraveyardShelfProps) {
  const empty = ripDays.length === 0 && calledItCount === 0;
  return (
    <section data-testid="graveyard-shelf" className={`space-y-2 ${className}`}>
      <h2 className="text-muted font-mono text-[11px] font-semibold tracking-widest uppercase">
        {obituaryCopy.graveyardHeading}
      </h2>
      {empty ? (
        <p className="text-muted text-sm" data-testid="graveyard-empty">
          {obituaryCopy.graveyardEmpty}
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {ripDays.map((days, i) => (
            <li
              key={i}
              data-testid="graveyard-rip"
              className="border-muted text-muted -rotate-2 rounded border font-mono text-[11px] tracking-wide uppercase"
            >
              <span className="px-2 py-0.5">
                <span aria-hidden="true">🪦 </span>
                {obituaryCopy.graveyardRip(days)}
              </span>
            </li>
          ))}
          {calledItCount > 0 ? (
            <li
              data-testid="graveyard-called-it"
              className="border-gold text-gold -rotate-2 rounded border px-2 py-0.5 font-mono text-[11px] tracking-wide uppercase"
            >
              {obituaryCopy.graveyardCalledIt(calledItCount)}
            </li>
          ) : null}
        </ul>
      )}
    </section>
  );
}
