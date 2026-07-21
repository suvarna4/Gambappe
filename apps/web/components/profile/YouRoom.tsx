import Link from 'next/link';
import type { MarketCategory } from '@receipts/core';
import { GraveyardShelf } from '@/components/GraveyardShelf';
import { TopicFollowChips } from '@/components/TopicFollowChips';
import { SaveRow } from '@/components/save/SaveRow';
import { ProfileHeaderStats } from './ProfileHeaderStats';
import { ProfileStatGrid } from './ProfileStatGrid';
import { ProfileTopicBars } from './ProfileTopicBars';
import { youCopy } from '@/lib/copy';

const LINK_CLASS = 'text-sm underline underline-offset-2';

export interface YouRoomClaimedProps {
  handle: string;
  slug: string;
  currentStreak: number;
  bestStreak: number;
  currentWinStreak: number;
  bestWinStreak: number;
  freezeBank: number;
  accuracyPercentile: number | null;
  walletVerified: boolean;
  /** Glicko rating (already resolved) or `null`. */
  rating: number | null;
  nemesis: { wins: number; losses: number; draws: number };
  badges: readonly string[];
  /** `fingerprint.category_shares` from the serializer, or `null`. */
  categoryShares: Partial<Record<MarketCategory, number>> | null;
  /** `{ rip, called_it_count }` graveyard block, or `null` when there's nothing to shelve. */
  graveyard: { rip: number[]; called_it_count: number } | null;
}

/**
 * `/you` claimed — the real record. Reuses the extracted `/p/[slug]` stat components verbatim
 * (WS22-T1 AC: no forked stat markup), adds the topic bars + graveyard shelf, and links out to the
 * public profile and settings. Presentational: the page maps the serializer model onto these props.
 */
export function YouRoomClaimed({
  handle,
  slug,
  currentStreak,
  bestStreak,
  currentWinStreak,
  bestWinStreak,
  freezeBank,
  accuracyPercentile,
  walletVerified,
  rating,
  nemesis,
  badges,
  categoryShares,
  graveyard,
}: YouRoomClaimedProps) {
  return (
    <main className="mx-auto max-w-2xl space-y-8 px-4 py-10" data-testid="you-claimed">
      <header className="space-y-3">
        <h1 className="text-2xl font-bold">{youCopy.heading}</h1>
        <p className="text-muted text-sm">{handle}</p>
        <ProfileHeaderStats
          currentStreak={currentStreak}
          freezeBank={freezeBank}
          accuracyPercentile={accuracyPercentile}
          walletVerified={walletVerified}
          freezeNote
        />
      </header>

      <ProfileStatGrid
        currentStreak={currentStreak}
        bestStreak={bestStreak}
        currentWinStreak={currentWinStreak}
        bestWinStreak={bestWinStreak}
        rating={rating}
        nemesis={nemesis}
        badges={badges}
      />

      <ProfileTopicBars shares={categoryShares} />

      {graveyard && (
        <GraveyardShelf ripDays={graveyard.rip} calledItCount={graveyard.called_it_count} />
      )}

      <nav className="flex flex-wrap gap-4" aria-label="Account">
        <Link href={`/p/${slug}`} className={LINK_CLASS} data-testid="you-public-profile-link">
          {youCopy.publicProfileLink}
        </Link>
        <Link href="/settings" className={LINK_CLASS} data-testid="you-settings-link">
          {youCopy.settingsLink}
        </Link>
      </nav>
    </main>
  );
}

export interface YouRoomGhostProps {
  /** Categories the ghost already follows (empty for a fully anonymous visitor). */
  followed: readonly MarketCategory[];
}

/**
 * `/you` ghost / signed-out — the SAME layout in its forming state: placeholder stats (via the
 * reused `ProfileStatGrid forming`), the reserved save-row slot WS21-T2 fills, and the ghost-
 * allowed `TopicFollowChips`. No save chip and no gold here (D-J8) — the save row owns the ask.
 */
export function YouRoomGhost({ followed }: YouRoomGhostProps) {
  return (
    <main className="mx-auto max-w-2xl space-y-8 px-4 py-10" data-testid="you-ghost">
      <header className="space-y-3">
        <h1 className="text-2xl font-bold">{youCopy.ghostHeading}</h1>
        <ProfileHeaderStats
          currentStreak={0}
          freezeBank={0}
          accuracyPercentile={null}
          walletVerified={false}
        />
        <p className="text-muted text-sm">{youCopy.ghostForming}</p>
      </header>

      <ProfileStatGrid
        forming
        currentStreak={0}
        bestStreak={0}
        currentWinStreak={0}
        bestWinStreak={0}
        rating={null}
        nemesis={{ wins: 0, losses: 0, draws: 0 }}
        badges={[]}
      />

      {/* WS21-T2 fills this reserved slot with the neutral, ghost-only Save row (D-J8): same
          `SaveAskCard` the value nudge uses, inline here as the record room's primary ask. It's a
          client component (reads its own value from `GET /me`); a claimed/anonymous viewer or the
          SSR pass renders nothing, keeping this room free of any gold ask. */}
      <div data-testid="you-save-row-slot">
        <SaveRow next="/you" />
      </div>

      <section aria-labelledby="you-follow-heading" className="space-y-3">
        <h2
          id="you-follow-heading"
          className="text-muted font-mono text-[11px] font-semibold tracking-widest uppercase"
        >
          {youCopy.followTopics}
        </h2>
        <TopicFollowChips initialFollowed={followed} />
      </section>
    </main>
  );
}
