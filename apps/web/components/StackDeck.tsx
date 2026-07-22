'use client';

import { useState } from 'react';
import { stackFeedSchema, type StackFeed } from '@receipts/core';
import { DeckQueue } from './DeckQueue';
import { TopicFollowChips } from './TopicFollowChips';

export interface StackDeckProps {
  /** The stack feed assembled server-side (`app/page.tsx`, viewer-free per INV-10). This is the
   * FIRST-paint deck; the topic filter refetches a viewer-scoped feed post-hydration. */
  feed: StackFeed;
  serverOffsetMs: number;
  arm?: boolean;
  duoQueue?: boolean;
  rivalHandle?: string | null;
}

/**
 * The home `/` stack: the mixed `DeckQueue` plus a topic filter row that actually changes the
 * cards. Toggling a chip persists a follow (`TopicFollowChips` → `POST|DELETE /api/v1/topics/
 * :category/follow`) and then this refetches `GET /api/v1/stack` — which deals the viewer's
 * followed categories (empty follows = all categories) — and swaps the feed, so `DeckQueue`
 * re-deals the new cards live (its `reset` effect).
 *
 * INV-10: the initial render is the server's viewer-free `feed` prop, and the chips SSR with an
 * empty followed set (no filter = all categories, matching that deck), so `/`'s first paint stays
 * byte-identical for every visitor. All viewer-specific behavior happens only after hydration, on
 * a user toggle. The chips start unhighlighted and reflect the truth as the viewer toggles (there
 * is no GET-follows endpoint to pre-seed from without breaking the viewer-free first paint).
 */
export function StackDeck({ feed: initialFeed, serverOffsetMs, arm, duoQueue, rivalHandle }: StackDeckProps) {
  const [feed, setFeed] = useState<StackFeed>(initialFeed);

  async function refetch() {
    try {
      const res = await fetch('/api/v1/stack', {
        headers: { accept: 'application/json' },
        cache: 'no-store',
      });
      if (!res.ok) return;
      const json = (await res.json()) as { data?: unknown };
      const parsed = stackFeedSchema.safeParse(json.data);
      if (parsed.success) setFeed(parsed.data);
    } catch {
      // A failed refetch leaves the current deck in place — never blocks the pick loop.
    }
  }

  return (
    <div className="space-y-4" data-testid="stack-deck">
      <div className="flex flex-col items-center gap-1.5">
        <span className="text-muted font-mono text-[10px] tracking-widest uppercase">
          Filter your stack
        </span>
        <TopicFollowChips initialFollowed={[]} onChanged={refetch} className="justify-center" />
      </div>
      <DeckQueue
        feed={feed}
        serverOffsetMs={serverOffsetMs}
        arm={arm}
        duoQueue={duoQueue}
        rivalHandle={rivalHandle}
      />
    </div>
  );
}
