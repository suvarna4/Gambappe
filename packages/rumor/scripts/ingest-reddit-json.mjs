#!/usr/bin/env node
/**
 * Manual live-corpus ingest (WS27 fallback): the owner saves public Reddit
 * `/comments/<id>.json` pages from their own browser and hands the files over; this
 * script turns each into a capture-once snapshot at data/lebron-2026/<postId>.json.
 * Existing snapshots are never overwritten (capture-once, owner decision 2026-07-24).
 *
 * Accepts any mix of .json files and directories (scanned non-recursively). Each file
 * must be the two-element array Reddit serves for a comments page: [postListing,
 * commentListing]. A listing-only file (search results) is rejected with a clear
 * message rather than mis-ingested.
 *
 * Requires the build first: pnpm --filter @receipts/rumor build
 * Run from packages/rumor: node scripts/ingest-reddit-json.mjs <file-or-dir ...>
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  LIVE_SAGA,
  assembleSnapshot,
  flattenRedditComments,
  parseRedditPostListing,
} from '../dist/index.js';
import { DATA_DIR } from './lib/load-corpus.mjs';

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('usage: node scripts/ingest-reddit-json.mjs <file.json | directory> ...');
  process.exit(1);
}

const files = [];
for (const arg of args) {
  const st = statSync(arg);
  if (st.isDirectory()) {
    for (const f of readdirSync(arg)) {
      if (f.endsWith('.json')) files.push(join(arg, f));
    }
  } else {
    files.push(arg);
  }
}

const dir = join(DATA_DIR, LIVE_SAGA.id);
mkdirSync(dir, { recursive: true });

let ingested = 0;
let skipped = 0;
let failed = 0;
for (const file of files) {
  let body;
  try {
    body = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    console.error(`✗ ${file}: not valid JSON (${err.message})`);
    failed += 1;
    continue;
  }
  if (!Array.isArray(body) || body.length < 2) {
    console.error(`✗ ${file}: expected the two-element /comments/<id>.json array`);
    failed += 1;
    continue;
  }
  const [post] = parseRedditPostListing(body[0]);
  if (!post) {
    console.error(`✗ ${file}: no t3 post in element [0]`);
    failed += 1;
    continue;
  }
  const out = join(dir, `${post.id}.json`);
  if (existsSync(out)) {
    console.log(`· ${post.id} already captured — skipped (capture-once)`);
    skipped += 1;
    continue;
  }
  const comments = flattenRedditComments(body[1]);
  const snapshot = assembleSnapshot({
    source: 'reddit-json',
    sagaId: LIVE_SAGA.id,
    fetchedAt: new Date().toISOString(),
    post,
    comments,
  });
  writeFileSync(out, JSON.stringify(snapshot));
  console.log(
    `✓ ${post.id} (${post.score}↑, ${comments.length} comments) r/${post.subreddit} — ${post.title.slice(0, 60)}`,
  );
  ingested += 1;
}
console.log(`\ningested ${ingested}, skipped ${skipped} existing, ${failed} failed`);
if (ingested > 0) {
  console.log('next: node scripts/live-snapshot.mjs  (recomputes crowd odds vs Polymarket)');
}
