/**
 * `/you` — the signed-in, record-first room (journeys plan D-J7 / §5 WS22-T1). Viewer-scoped and
 * dynamic: it reads the viewer's identity from the request cookies, so NOTHING here may be ISR-
 * cached (contrast `/p/[slug]`, the viewer-free public profile that IS ISR — INV-10). The two
 * rooms deliberately share their stat markup: this page reuses the extracted `components/profile/*`
 * pieces (`ProfileHeaderStats`, `ProfileStatGrid`, `ProfileTopicBars`) and the existing
 * `GraveyardShelf` via `YouRoomClaimed`/`YouRoomGhost` rather than forking the record chrome
 * (§5 WS22-T1 AC).
 *
 *   claimed → the real record (stat header w/ freeze note + accuracy, the four-up stat grid, topic
 *             bars from `fingerprint.category_shares`, the graveyard shelf, links to `/p/{slug}` +
 *             `/settings`).
 *   ghost / signed-out → the SAME layout in its forming state: placeholder stats, a reserved save-
 *             row slot (WS21-T2 fills it), and the ghost-allowed `TopicFollowChips` (WS18-T2).
 *
 * Seam (journeys plan §7 seam 5): the only shell wiring this task touches is the one-line
 * `SHELL_ROUTES.you` flip in `TabBar.tsx`. This page renders its own `<main>`; it does not touch
 * `layout.tsx`.
 */
import { getFollows } from '@receipts/db';
import { YouRoomClaimed, YouRoomGhost } from '@/components/profile/YouRoom';
import { getProfilePageModel } from '@/lib/profile-page';
import { resolveViewerIdentity } from '@/lib/identity-request';
import { getDb } from '@/lib/stores';

// Viewer-scoped: identity is resolved from cookies per request, so this must never be prerendered
// or ISR-cached. INV-10 keeps the PUBLIC surfaces viewer-free; `/you` is the opposite — the one
// page entirely about the viewer, hence force-dynamic.
export const dynamic = 'force-dynamic';

export default async function YouPage() {
  const db = getDb();
  const identity = await resolveViewerIdentity();

  if (identity.kind === 'claimed') {
    const model = await getProfilePageModel(db, identity.profile.slug, null);
    // A claimed profile always resolves a model (it exists + isn't deleted, by identity
    // resolution); the fallback below keeps the room from 500ing on any unexpected race.
    if (model) {
      const { profile, stats } = model;
      return (
        <YouRoomClaimed
          handle={profile.handle}
          slug={profile.slug}
          currentStreak={profile.currentStreak}
          bestStreak={profile.bestStreak}
          currentWinStreak={profile.currentWinStreak}
          bestWinStreak={profile.bestWinStreak}
          freezeBank={profile.freezeBank}
          accuracyPercentile={stats.rating?.accuracy_percentile ?? null}
          walletVerified={stats.wallet?.verified ?? false}
          rating={stats.rating ? stats.rating.glicko_rating : null}
          nemesis={stats.nemesisSummary}
          badges={stats.badges}
          categoryShares={stats.fingerprint?.category_shares ?? null}
          graveyard={stats.graveyard}
        />
      );
    }
  }

  // Ghost or anonymous: the forming room. A ghost with a cookie has its followed topics seeded; a
  // fully anonymous visitor starts from an empty set.
  const followed = identity.kind === 'ghost' ? await getFollows(db, identity.profile.id) : [];
  return <YouRoomGhost followed={followed} />;
}
