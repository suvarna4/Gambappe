import type { RumorRadarView } from '@/lib/rumor-radar';
import { crowdCopy } from '@/lib/copy';

/**
 * WS27-T8 · Rumor Radar panel on `/crowd` (docs/plans/ws27-rumor-radar.md): the live
 * Reddit-crowd vs Polymarket read on the LeBron destination question, from committed
 * snapshot data. Server component, no client state, no viewer identity — the page's
 * INV-10 viewer-free render is untouched. Gated by FLAG_RUMOR_RADAR in the page.
 *
 * Color semantics reuse the app's two-sides tokens: `side-a` = the market (money),
 * `side-b` = the crowd (chatter) — the same visual language as a question's two sides.
 */
export function RumorRadar({ view }: { view: RumorRadarView }) {
  const shown = view.rows.filter((r) => r.market >= 0.01 || r.crowd >= 0.05);
  const folded = view.rows.length - shown.length;
  const max = Math.max(...shown.map((r) => Math.max(r.crowd, r.market)));
  const width = (p: number) => `${Math.max((p / max) * 100, 1).toFixed(1)}%`;
  const pct = (p: number) => `${(100 * p).toFixed(1)}%`;

  return (
    <section
      data-testid="rumor-radar"
      className="bg-surface mb-8 rounded-lg p-5"
      aria-label={crowdCopy.rumorRadarHeading}
    >
      <header className="mb-1 flex items-baseline justify-between gap-3">
        <h2 className="font-display text-lg font-bold tracking-tight">
          {crowdCopy.rumorRadarHeading}
        </h2>
        <span className="text-muted font-mono text-xs">{view.date}</span>
      </header>
      <p className="text-muted mb-4 text-sm">{view.question}</p>

      <div className="text-muted mb-2 flex gap-4 font-mono text-xs">
        <span>
          <i aria-hidden className="bg-side-a mr-1.5 inline-block h-2 w-2 rounded-xs" />
          {crowdCopy.rumorRadarMarketKey}
        </span>
        <span>
          <i aria-hidden className="bg-side-b mr-1.5 inline-block h-2 w-2 rounded-xs" />
          {crowdCopy.rumorRadarCrowdKey}
        </span>
      </div>

      <ul className="space-y-2">
        {shown.map((row) => (
          <li key={row.team} className="grid grid-cols-[2.5rem_1fr] items-center gap-3">
            <span className="text-muted font-mono text-xs" title={row.name}>
              {row.team}
            </span>
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <div className="bg-bg h-2.5 flex-1 overflow-hidden rounded-xs">
                  <div
                    className="bg-side-a h-full rounded-xs"
                    style={{ width: width(row.market) }}
                  />
                </div>
                <span className="text-muted w-12 text-right font-mono text-xs">
                  {pct(row.market)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="bg-bg h-2.5 flex-1 overflow-hidden rounded-xs">
                  <div
                    className="bg-side-b h-full rounded-xs"
                    style={{ width: width(row.crowd) }}
                  />
                </div>
                <span className="text-muted w-12 text-right font-mono text-xs">
                  {pct(row.crowd)}
                </span>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <p className="text-muted mt-4 text-xs leading-relaxed">
        {view.topPickAgrees ? crowdCopy.rumorRadarAgree : crowdCopy.rumorRadarDisagree}{' '}
        {crowdCopy.rumorRadarMethod(view.threads, view.comments)}
        {folded > 0 ? ` ${crowdCopy.rumorRadarFolded(folded)}` : ''}{' '}
        {crowdCopy.rumorRadarResolves(view.resolvesBy)}
      </p>
    </section>
  );
}
