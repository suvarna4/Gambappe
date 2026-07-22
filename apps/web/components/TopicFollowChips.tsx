'use client';

import { useState } from 'react';
import { MARKET_CATEGORY, type MarketCategory } from '@receipts/core';

export interface TopicFollowChipsProps {
  /** Categories the viewer already follows (server-provided initial state). */
  initialFollowed: readonly MarketCategory[];
  /** Optional open-topic counts per category, rendered as `· N` on the chip. */
  counts?: Partial<Record<MarketCategory, number>>;
  /** Read-only render (no toggling) — e.g. a spectator preview. */
  disabled?: boolean;
  /**
   * Fired after a follow toggle successfully persists, with the new followed set. The home stack
   * (`StackDeck`) uses it to refetch the deck so a topic change re-deals the cards live. Optional,
   * so the `/you` call site is unchanged.
   */
  onChanged?: (followed: readonly MarketCategory[]) => void;
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
 * WS18-T2 · Topic-follow chips (journeys plan §5 WS18-T2). A standalone, host-agnostic control —
 * imported by the stack's end-of-deck state (WS18-T3) and `/you` (WS22-T1). Toggles
 * `POST | DELETE /api/v1/topics/:category/follow` optimistically, rolling back on failure.
 * Neutral styling only (no gold — gold is for wins per D-J8); the followed state reads as the
 * bright paper ink, unfollowed as muted.
 */
export function TopicFollowChips({
  initialFollowed,
  counts,
  disabled = false,
  onChanged,
  className = '',
}: TopicFollowChipsProps) {
  const [followed, setFollowed] = useState<Set<MarketCategory>>(() => new Set(initialFollowed));
  const [pending, setPending] = useState<Set<MarketCategory>>(() => new Set());

  function mutate(set: Set<MarketCategory>, category: MarketCategory, add: boolean): Set<MarketCategory> {
    const next = new Set(set);
    if (add) next.add(category);
    else next.delete(category);
    return next;
  }

  async function toggle(category: MarketCategory) {
    if (disabled || pending.has(category)) return;
    const wasFollowed = followed.has(category);
    const nextFollowed = mutate(followed, category, !wasFollowed);

    // Optimistic flip + rollback on failure.
    setFollowed(nextFollowed);
    setPending((prev) => mutate(prev, category, true));
    try {
      const res = await fetch(`/api/v1/topics/${category}/follow`, {
        method: wasFollowed ? 'DELETE' : 'POST',
      });
      if (!res.ok) throw new Error(`follow toggle failed: ${res.status}`);
      // Persisted — let a host (the home stack) re-deal against the new follow set.
      onChanged?.([...nextFollowed]);
    } catch {
      setFollowed((prev) => mutate(prev, category, wasFollowed));
    } finally {
      setPending((prev) => mutate(prev, category, false));
    }
  }

  return (
    <div
      data-testid="topic-follow-chips"
      className={`flex flex-wrap gap-2 ${className}`}
      role="group"
      aria-label="Follow topics"
    >
      {MARKET_CATEGORY.map((category) => {
        const on = followed.has(category);
        const count = counts?.[category];
        return (
          <button
            key={category}
            type="button"
            data-testid={`topic-chip-${category}`}
            aria-pressed={on}
            disabled={disabled || pending.has(category)}
            onClick={() => toggle(category)}
            className={`font-display text-[11px] font-bold tracking-wide uppercase rounded border-2 px-2.5 py-0.5 transition-colors disabled:opacity-50 ${
              on ? 'border-paper text-paper' : 'border-muted text-muted'
            }`}
          >
            {CATEGORY_LABEL[category]}
            {count !== undefined ? ` · ${count}` : ''}
          </button>
        );
      })}
    </div>
  );
}
