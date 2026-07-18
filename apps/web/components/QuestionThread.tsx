'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { REACTION_SET, type postSchema } from '@receipts/core';
import type { z } from 'zod';
import { copy, threadCopy } from '@/lib/copy';
import { ApiClientError, fetchMe } from '@/lib/pick-client';
import { createQuestionPost, fetchQuestionThread, submitReaction } from '@/lib/thread-client';

// Code-split + `ssr: false` (not a static top-level import): `ClaimSheet` → `ClaimEntry` →
// `app/claim/actions.ts` (`'use server'`) → `auth.ts` → `next-auth`, which pulls in `next/server`
// — real Next.js resolves that fine, but a plain `react-dom/server` render under Vitest (no
// Next.js runtime, see `test/question-state-view.test.tsx`'s own header comment on why
// `pick-client.ts` avoids the same chain) can't resolve it. Deferring the import to the client
// keeps this component's SSR pass (and its INV-10 reserved-slot tests) free of that dependency —
// `ClaimSheet` itself is `open`-gated and renders `null` until a viewer actually needs it, so
// nothing user-visible waits on the extra chunk.
const ClaimSheet = dynamic(() => import('./claim/ClaimSheet'), { ssr: false });

type PostPublic = z.infer<typeof postSchema>;
type ReactionEmoji = (typeof REACTION_SET)[number];

export interface QuestionThreadProps {
  questionId: string;
  questionSlug: string;
}

type MeState = { status: 'loading' } | { status: 'ready'; claimed: boolean } | { status: 'error' };

function formatPostTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/**
 * The §10.3 `revealed`-state "thread" (§9.2, WS7-T8 AC: "ghost sees read + reactions, post box
 * gated with claim prompt"). Entirely a client island — reading the thread is public data
 * (`GET .../thread` is `auth: none`), but this component ALSO needs viewer identity (to gate the
 * post box) and mutation state, so — same as `RevealSequence` next to it — it self-fetches
 * rather than taking anything server-rendered (INV-10: the SSR shell stays viewer-free).
 *
 * SPEC-GAP(ws7-t8): §9.2's thread response is aggregate `reaction_counts` only — there's no
 * endpoint that reports which reactions THIS viewer has already added, so "is this emoji mine"
 * can only be tracked for actions taken in the current session (`myReactions` below), not
 * restored on reload. A returning visitor sees accurate totals but loses their own
 * highlighted-state until they react again this session.
 */
export function QuestionThread({ questionId, questionSlug }: QuestionThreadProps) {
  const [me, setMe] = useState<MeState>({ status: 'loading' });
  const [posts, setPosts] = useState<PostPublic[] | null>(null);
  const [reactionCounts, setReactionCounts] = useState<Record<string, number>>({});
  const [myReactions, setMyReactions] = useState<Set<string>>(new Set());
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [reactionError, setReactionError] = useState<string | null>(null);

  const [composerText, setComposerText] = useState('');
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [claimSheetOpen, setClaimSheetOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetchMe()
      .then(({ data }) => {
        if (!cancelled) setMe({ status: 'ready', claimed: data.profile.kind === 'claimed' });
      })
      .catch(() => {
        if (!cancelled) setMe({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchQuestionThread(questionSlug)
      .then(({ data }) => {
        if (cancelled) return;
        setPosts(data.data.posts);
        setReactionCounts(
          Object.fromEntries(data.data.reaction_counts.map((r) => [r.emoji, r.count])),
        );
        setNextCursor(data.meta.next_cursor);
      })
      .catch(() => {
        if (!cancelled) setThreadError(threadCopy.loadError);
      });
    return () => {
      cancelled = true;
    };
  }, [questionSlug]);

  const handleLoadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const { data } = await fetchQuestionThread(questionSlug, nextCursor);
      setPosts((prev) => [...(prev ?? []), ...data.data.posts]);
      setNextCursor(data.meta.next_cursor);
    } catch {
      setThreadError(threadCopy.loadError);
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor, loadingMore, questionSlug]);

  const handleReact = useCallback(
    async (emoji: ReactionEmoji) => {
      setReactionError(null);
      const wasMine = myReactions.has(emoji);
      // Optimistic update — reverted on failure below.
      setMyReactions((prev) => {
        const next = new Set(prev);
        if (wasMine) next.delete(emoji);
        else next.add(emoji);
        return next;
      });
      setReactionCounts((prev) => ({
        ...prev,
        [emoji]: Math.max(0, (prev[emoji] ?? 0) + (wasMine ? -1 : 1)),
      }));
      try {
        await submitReaction('question', questionId, emoji);
      } catch {
        setMyReactions((prev) => {
          const next = new Set(prev);
          if (wasMine) next.add(emoji);
          else next.delete(emoji);
          return next;
        });
        setReactionCounts((prev) => ({
          ...prev,
          [emoji]: Math.max(0, (prev[emoji] ?? 0) + (wasMine ? 1 : -1)),
        }));
        setReactionError(threadCopy.reactionError);
      }
    },
    [myReactions, questionId],
  );

  const claimed = me.status === 'ready' && me.claimed;

  const handleComposerFocus = useCallback(() => {
    if (me.status === 'ready' && !claimed) {
      textareaRef.current?.blur();
      setClaimSheetOpen(true);
    }
  }, [me, claimed]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!claimed) {
        setClaimSheetOpen(true);
        return;
      }
      const body = composerText.trim();
      if (!body) return;
      setPosting(true);
      setPostError(null);
      try {
        const { data } = await createQuestionPost(questionId, { body });
        setPosts((prev) => [...(prev ?? []), data.post]);
        setComposerText('');
      } catch (err) {
        setPostError(
          err instanceof ApiClientError && err.code === 'RATE_LIMITED'
            ? copy.errors.RATE_LIMITED
            : threadCopy.postError,
        );
      } finally {
        setPosting(false);
      }
    },
    [claimed, composerText, questionId],
  );

  return (
    <div className="space-y-3" data-testid="question-thread">
      <h2 className="text-muted text-xs font-semibold tracking-wide uppercase">
        {threadCopy.heading}
      </h2>

      <div className="flex flex-wrap gap-2" data-testid="reaction-bar">
        {REACTION_SET.map((emoji) => {
          const mine = myReactions.has(emoji);
          return (
            <button
              key={emoji}
              type="button"
              onClick={() => handleReact(emoji)}
              aria-label={`${threadCopy.reactionLabels[emoji]} (${reactionCounts[emoji] ?? 0})`}
              aria-pressed={mine}
              data-testid={`reaction-${emoji}`}
              className={`min-h-11 min-w-11 rounded border px-3 py-2 font-mono text-sm ${
                mine ? 'border-side-a bg-side-a/10' : 'border-muted/30'
              }`}
            >
              <span aria-hidden="true">{emoji}</span> {reactionCounts[emoji] ?? 0}
            </button>
          );
        })}
      </div>
      {reactionError ? (
        <p className="text-loss text-xs" data-testid="reaction-error">
          {reactionError}
        </p>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-2" data-testid="post-composer">
        <textarea
          ref={textareaRef}
          value={composerText}
          onChange={(e) => setComposerText(e.target.value)}
          onFocus={handleComposerFocus}
          placeholder={threadCopy.postPlaceholder}
          maxLength={500}
          rows={2}
          disabled={posting}
          data-testid="post-composer-input"
          className="border-muted/30 min-h-11 w-full rounded border bg-transparent p-2 text-sm"
        />
        <button
          type="submit"
          disabled={posting || me.status === 'loading' || (claimed && composerText.trim().length === 0)}
          data-testid="post-composer-submit"
          className="bg-side-a min-h-11 rounded px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
        >
          {me.status === 'loading' ? threadCopy.postSubmit : claimed ? threadCopy.postSubmit : threadCopy.postClaimGateCta}
        </button>
        {postError ? (
          <p className="text-loss text-xs" data-testid="post-error">
            {postError}
          </p>
        ) : null}
      </form>

      <ClaimSheet open={claimSheetOpen} onOpenChange={setClaimSheetOpen} />

      <div className="space-y-2" data-testid="thread-posts">
        {posts === null ? (
          threadError ? (
            <p className="text-loss text-xs" data-testid="thread-error">
              {threadError}
            </p>
          ) : (
            <div className="min-h-11" data-testid="thread-loading" aria-hidden="true" />
          )
        ) : posts.length === 0 ? (
          <p className="text-muted text-xs">{threadCopy.empty}</p>
        ) : (
          posts.map((post) => (
            <div key={post.id} className="space-y-0.5" data-testid="thread-post">
              <p className="text-xs">
                <span className="font-semibold">{post.author.handle}</span>{' '}
                <span className="text-muted font-mono">{formatPostTime(post.created_at)}</span>
              </p>
              <p className="text-sm">{post.body}</p>
            </div>
          ))
        )}
        {threadError && posts !== null ? (
          <p className="text-loss text-xs" data-testid="thread-error">
            {threadError}
          </p>
        ) : null}
        {nextCursor ? (
          <button
            type="button"
            onClick={handleLoadMore}
            disabled={loadingMore}
            data-testid="thread-load-more"
            className="text-muted min-h-11 text-xs underline disabled:opacity-50"
          >
            {threadCopy.loadMore}
          </button>
        ) : null}
      </div>
    </div>
  );
}
