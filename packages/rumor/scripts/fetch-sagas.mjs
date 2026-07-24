#!/usr/bin/env node
/**
 * Fetch the historical saga corpus from Arctic Shift (docs/plans/ws27-rumor-radar.md §2A,
 * WS27-T1). For each saga in the manifest: sweep post search across its subreddits and
 * window, rank by score client-side, take the top RUMOR_TOP_POSTS, then fetch each post's
 * full comment tree (created_utc-cursor pagination) and write one snapshot file:
 * data/<sagaId>/<postId>.json.
 *
 * Capture-once discipline (owner decision 2026-07-24): an existing snapshot file is never
 * re-fetched — re-running the script only fills gaps, so it is safely resumable.
 *
 * Requires the build first (imports from ../dist): pnpm --filter @receipts/rumor build
 * Run from packages/rumor: node scripts/fetch-sagas.mjs [sagaId ...]
 */
import { mkdirSync, existsSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';

import {
  ARCTIC_SHIFT_PAGE_LIMIT,
  SAGAS,
  assembleSnapshot,
  buildCommentSearchUrl,
  buildPostSearchUrl,
  parseCommentsResponse,
  parsePostsResponse,
} from '../dist/index.js';

// Node's fetch ignores HTTPS_PROXY without an explicit dispatcher (same fix as
// packages/sim/scripts/fetch-football-data.mjs).
setGlobalDispatcher(new EnvHttpProxyAgent());

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const TOP_POSTS = Number(process.env.RUMOR_TOP_POSTS ?? 50);
const MAX_COMMENT_PAGES = Number(process.env.RUMOR_MAX_COMMENT_PAGES ?? 12);
const PACE_MS = Number(process.env.RUMOR_PACE_MS ?? 750);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' } });
      if (res.status === 429 || res.status >= 500) {
        console.warn(`  ${res.status} from ${url} — backing off`);
        await sleep(2000 * 2 ** attempt);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.json();
    } catch (err) {
      if (attempt === 3) throw err;
      console.warn(`  retrying after error: ${err.message}`);
      await sleep(2000 * 2 ** attempt);
    }
  }
  throw new Error('unreachable');
}

/** Sweep one subreddit's window via created_utc-cursor pagination. */
async function sweepPosts(saga, subreddit) {
  const posts = [];
  let cursor = saga.from;
  for (;;) {
    const url = buildPostSearchUrl({
      subreddit,
      titleQuery: saga.titleQuery,
      after: cursor,
      before: saga.to,
    });
    const page = parsePostsResponse(await getJson(url));
    posts.push(...page);
    if (page.length < ARCTIC_SHIFT_PAGE_LIMIT) return posts;
    cursor = Math.max(...page.map((p) => p.createdUtc));
    await sleep(PACE_MS);
  }
}

async function fetchCommentTree(postId) {
  const comments = [];
  let cursor;
  for (let pageNo = 0; pageNo < MAX_COMMENT_PAGES; pageNo++) {
    const url = buildCommentSearchUrl({ linkId: postId, after: cursor });
    const page = parseCommentsResponse(await getJson(url));
    comments.push(...page);
    if (page.length < ARCTIC_SHIFT_PAGE_LIMIT) break;
    cursor = Math.max(...page.map((c) => c.createdUtc));
    await sleep(PACE_MS);
  }
  return comments;
}

async function fetchSaga(saga) {
  const dir = join(DATA_DIR, saga.id);
  mkdirSync(dir, { recursive: true });
  console.log(`\n=== ${saga.id} (${saga.player} → ${saga.outcome}) ${saga.from}..${saga.to}`);

  const bySub = [];
  for (const subreddit of saga.subreddits) {
    const posts = await sweepPosts(saga, subreddit);
    console.log(`  r/${subreddit}: ${posts.length} posts`);
    bySub.push(...posts);
    await sleep(PACE_MS);
  }
  // Dedupe (crossposts appear per-sub), then rank by score — the top posts ARE the corpus.
  const unique = [...new Map(bySub.map((p) => [p.id, p])).values()];
  const top = unique.sort((a, b) => b.score - a.score).slice(0, TOP_POSTS);

  let written = 0;
  let skipped = 0;
  for (const post of top) {
    const file = join(dir, `${post.id}.json`);
    if (existsSync(file)) {
      skipped++;
      continue;
    }
    const comments = await fetchCommentTree(post.id);
    const snapshot = assembleSnapshot({
      source: 'arctic-shift',
      sagaId: saga.id,
      fetchedAt: new Date().toISOString(),
      post,
      comments,
    });
    writeFileSync(file, JSON.stringify(snapshot));
    written++;
    await sleep(PACE_MS);
  }
  console.log(
    `  corpus: ${unique.length} unique posts → top ${top.length}; wrote ${written}, kept ${skipped} existing, ${readdirSync(dir).length} total on disk`,
  );
}

const only = process.argv.slice(2);
const targets = only.length > 0 ? SAGAS.filter((s) => only.includes(s.id)) : SAGAS;
if (targets.length === 0) {
  console.error(`No matching sagas. Known: ${SAGAS.map((s) => s.id).join(', ')}`);
  process.exit(1);
}
for (const saga of targets) await fetchSaga(saga);
console.log('\nDone.');
