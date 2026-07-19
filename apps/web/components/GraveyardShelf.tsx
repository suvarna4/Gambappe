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
 * Data source (SW9-T3, resolving the original SW4-T3 SPEC-GAP): the lengths-only
 * `ProfilePublic.graveyard` block (§9.2 — `{ rip, called_it_count }`, replay-derived). `ripDays`
 * carries bare run lengths by design — the privacy pin retires the old "chips link to the day's
 * question page" AC, so chips are static text, never links. `/p/[slug]` mounts this only when
 * the block is non-null (empty history renders nothing at all, per the SW4-T3 empty-state AC);
 * the internal empty state below remains for the `/dev/ui` gallery.
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
