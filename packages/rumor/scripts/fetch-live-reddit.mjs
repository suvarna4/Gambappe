#!/usr/bin/env node
/**
 * Capture-once live corpus fetcher (WS27-T6). Sweeps the LIVE_SAGA subreddits for
 * LeBron posts via the official Reddit API (app-only OAuth), and for each post that is
 * ≥2h old and not yet on disk, captures its comment tree ONCE into
 * data/lebron-2026/<postId>.json. Re-running only fills gaps (owner decision
 * 2026-07-24: no re-snapshotting).
 *
 * Env: REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET (script app), optional
 * REDDIT_USER_AGENT. Exits with a clear message when unset.
 *
 * Requires the build first: pnpm --filter @receipts/rumor build
 * Run from packages/rumor: node scripts/fetch-live-reddit.mjs
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';

import {
  LIVE_SAGA,
  REDDIT_OAUTH_BASE,
  REDDIT_TOKEN_URL,
  assembleSnapshot,
  flattenRedditComments,
  isCaptureReady,
  parseRedditPostListing,
} from '../dist/index.js';
import { DATA_DIR } from './lib/load-corpus.mjs';

setGlobalDispatcher(new EnvHttpProxyAgent());

const clientId = process.env.REDDIT_CLIENT_ID;
const clientSecret = process.env.REDDIT_CLIENT_SECRET;
const userAgent = process.env.REDDIT_USER_AGENT ?? 'script:rumor-radar:v1 (research)';
if (!clientId || !clientSecret) {
  console.error(
    'REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET not set.\n' +
      'Create a "script" app at https://www.reddit.com/prefs/apps and export both.',
  );
  process.exit(1);
}

const PACE_MS = Number(process.env.RUMOR_PACE_MS ?? 1100); // free tier: ~60 req/min
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getToken() {
  const res = await fetch(REDDIT_TOKEN_URL, {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': userAgent,
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`token request failed: HTTP ${res.status}`);
  const body = await res.json();
  if (!body.access_token) throw new Error('token response had no access_token');
  return body.access_token;
}

async function api(token, path) {
  const res = await fetch(`${REDDIT_OAUTH_BASE}${path}`, {
    headers: { authorization: `Bearer ${token}`, 'user-agent': userAgent },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
  return res.json();
}

const token = await getToken();
console.log('OAuth token acquired.');

const dir = join(DATA_DIR, LIVE_SAGA.id);
mkdirSync(dir, { recursive: true });
const now = Math.floor(Date.now() / 1000);

// Sweep: top + new listings per subreddit so both risers and fresh threads are seen.
const seen = new Map();
for (const sub of LIVE_SAGA.subreddits) {
  for (const listing of ['top', 'new']) {
    const path =
      `/r/${sub}/search?q=${encodeURIComponent(LIVE_SAGA.titleQuery)}&restrict_sr=1` +
      `&sort=${listing === 'top' ? 'top' : 'new'}&t=week&limit=100&raw_json=1`;
    const posts = parseRedditPostListing(await api(token, path));
    for (const p of posts) seen.set(p.id, p);
    await sleep(PACE_MS);
  }
  console.log(`r/${sub}: ${seen.size} cumulative posts`);
}

let captured = 0;
let tooYoung = 0;
let existing = 0;
for (const post of [...seen.values()].sort((a, b) => b.score - a.score)) {
  const file = join(dir, `${post.id}.json`);
  if (existsSync(file)) {
    existing += 1;
    continue;
  }
  if (!isCaptureReady(post, now)) {
    tooYoung += 1;
    continue;
  }
  const tree = await api(token, `/comments/${post.id}?limit=500&depth=10&sort=top&raw_json=1`);
  const comments = flattenRedditComments(Array.isArray(tree) ? tree[1] : null);
  const snapshot = assembleSnapshot({
    source: 'reddit-oauth',
    sagaId: LIVE_SAGA.id,
    fetchedAt: new Date().toISOString(),
    post,
    comments,
  });
  writeFileSync(file, JSON.stringify(snapshot));
  captured += 1;
  console.log(`  captured ${post.id} (${post.score}↑, ${comments.length} comments)`);
  await sleep(PACE_MS);
}

console.log(
  `\ndone: ${captured} new captures, ${existing} already on disk, ${tooYoung} younger than 2h (next sweep's problem)`,
);
