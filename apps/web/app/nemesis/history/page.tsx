import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getProfileByUserId } from '@receipts/db';
import { auth } from '../../../auth';
import { NemesisHistoryList } from '@/components/nemesis/NemesisHistoryList';
import { getNemesisHistoryPage, NEMESIS_HISTORY_DEFAULT_LIMIT } from '@/lib/nemesis/service';
import { getDb } from '@/lib/stores';

/**
 * `/nemesis/history` — the claimed viewer's full lifetime nemesis history, split out of
 * `/nemesis/page.tsx` (design-diff audit, same reasoning as the `/nemesis/matchup` split): that
 * page is now about the CURRENT nemesis-week moment only (assignment/verdict/empty state machine,
 * `selectNemesisPageState`), and the mockup itself never shows the aggregate list on the same
 * exhibit as the current-week card.
 *
 * Auth-gated exactly like `/nemesis/page.tsx` and `/nemesis/matchup/page.tsx` — same `auth()` +
 * `getProfileByUserId` + redirect-to-`/claim` pattern, copied rather than reinvented.
 *
 * `NemesisHistoryList` renders every entry as a plain compact row (opponent, score, week,
 * outcome badge) — no head-to-head banner, no verdict swipe card, no rematch-request affordance
 * (explicit design feedback: an earlier version of this route reused those, and every row ended
 * up far too large for what's meant to be a read-only past record; rematch requests are a
 * CURRENT-week action that belongs on `/nemesis` itself, not here). That means this route has no
 * per-pairing scoreboard fetch to do either — it only needs what `GET /me/nemesis-history`
 * already returns.
 */
export const dynamic = 'force-dynamic';

export default async function NemesisHistoryPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/claim');

  const db = getDb();
  const profile = await getProfileByUserId(db, session.user.id);
  if (!profile || profile.kind !== 'claimed') redirect('/claim');

  const historyPage = await getNemesisHistoryPage(db, profile.id, {
    limit: NEMESIS_HISTORY_DEFAULT_LIMIT,
  });

  return (
    <main className="mx-auto max-w-xl space-y-6 px-6 py-10">
      <Link href="/nemesis" className="text-muted text-sm underline underline-offset-2">
        ← Your nemesis
      </Link>
      <h1 className="text-2xl font-bold">History</h1>
      <NemesisHistoryList entries={historyPage.data} />
    </main>
  );
}
