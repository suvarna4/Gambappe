import { MARKET_CATEGORY, type MarketCategory } from '@receipts/core';

export interface ProfileTopicBarsProps {
  /**
   * Per-category pick shares (0..1), the `fingerprint.category_shares` block the profile serializer
   * already exposes (§9.2, `lib/profile-page.ts`). `null`/absent → the caller renders nothing.
   */
  shares: Partial<Record<MarketCategory, number>> | null;
  className?: string;
}

const CATEGORY_LABEL: Record<MarketCategory, string> = {
  sports: 'Sports',
  politics: 'Politics',
  economics: 'Economics',
  culture: 'Culture',
  science: 'Science',
  other: 'Other',
};

/**
 * Topic bars for the profile record surfaces (WS22-T1): the viewer's pick mix across
 * `MARKET_CATEGORY`, drawn from the serializer's `fingerprint.category_shares` (no new data path).
 * Neutral ink only — no gold (D-J8: gold is for wins). Presentational; renders bars only for
 * categories with a positive share, largest first, and nothing at all when there's no share data.
 */
export function ProfileTopicBars({ shares, className = '' }: ProfileTopicBarsProps) {
  const rows = MARKET_CATEGORY.map((category) => ({
    category,
    share: shares?.[category] ?? 0,
  }))
    .filter((row) => row.share > 0)
    .sort((a, b) => b.share - a.share);

  if (rows.length === 0) return null;

  return (
    <section
      aria-labelledby="topic-bars-heading"
      data-testid="profile-topic-bars"
      className={`space-y-2 ${className}`}
    >
      <h2
        id="topic-bars-heading"
        className="text-muted font-mono text-[11px] font-semibold tracking-widest uppercase"
      >
        Topics
      </h2>
      <ul className="space-y-1.5">
        {rows.map(({ category, share }) => {
          const pct = Math.round(share * 100);
          return (
            <li
              key={category}
              data-testid={`topic-bar-${category}`}
              className="flex items-center gap-3"
            >
              <span className="text-muted w-20 shrink-0 font-mono text-[11px] tracking-wide uppercase">
                {CATEGORY_LABEL[category]}
              </span>
              <span className="bg-surface relative h-2 flex-1 overflow-hidden rounded">
                <span
                  className="bg-paper absolute inset-y-0 left-0 rounded"
                  style={{ width: `${pct}%` }}
                />
              </span>
              <span className="text-muted w-10 shrink-0 text-right font-mono text-[11px]">
                {pct}%
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
