#!/usr/bin/env node
/**
 * Daily crowd-vs-market snapshot (WS27-T6). Recomputes crowd odds over the accumulated
 * live corpus with the trained skill (data/skills/skill-live.json, falling back to the
 * untrained default), fetches + de-vigs the Polymarket event, computes divergence, and
 * appends one row to the committed data/live/odds-history.jsonl. Safe to run with no
 * Reddit corpus yet — the market side records either way (crowd fields null).
 *
 * Requires the build first: pnpm --filter @receipts/rumor build
 * Run from packages/rumor: node scripts/live-snapshot.mjs
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';

import {
  LIVE_SAGA,
  POLYMARKET_GAMMA_BASE,
  aggregateCrowdOdds,
  defaultRumorSkill,
  devigMarket,
  divergence,
  isRumorSkill,
  parseGammaEvent,
} from '../dist/index.js';
import { DATA_DIR, loadSagaEntries } from './lib/load-corpus.mjs';

setGlobalDispatcher(new EnvHttpProxyAgent());

const LIVE_DIR = join(DATA_DIR, 'live');
const HISTORY = join(LIVE_DIR, 'odds-history.jsonl');
const now = Math.floor(Date.now() / 1000);

// ---- skill ---------------------------------------------------------------------------
const skillPath = join(DATA_DIR, 'skills', 'skill-live.json');
let skill = defaultRumorSkill('untrained');
if (existsSync(skillPath)) {
  const loaded = JSON.parse(readFileSync(skillPath, 'utf8'));
  if (isRumorSkill(loaded)) skill = loaded;
  else console.warn('skill-live.json failed validation — using untrained defaults');
}

// ---- crowd side ----------------------------------------------------------------------
const liveCorpusDir = join(DATA_DIR, LIVE_SAGA.id);
const posts = existsSync(liveCorpusDir) ? readdirSync(liveCorpusDir).length : 0;
const entries = loadSagaEntries(LIVE_SAGA.id);
const crowd =
  entries !== null && entries.length > 0
    ? aggregateCrowdOdds(entries, skill, LIVE_SAGA.candidates, now)
    : null;

// ---- market side ---------------------------------------------------------------------
const res = await fetch(`${POLYMARKET_GAMMA_BASE}/events?slug=${LIVE_SAGA.marketSlug}`);
if (!res.ok) throw new Error(`gamma API: HTTP ${res.status}`);
const market = devigMarket(parseGammaEvent(await res.json()), LIVE_SAGA.candidates);

// ---- compare + append ----------------------------------------------------------------
const div = crowd ? divergence(crowd, market, LIVE_SAGA.candidates) : null;
const row = {
  date: new Date(now * 1000).toISOString().slice(0, 10),
  asOf: now,
  skillCutoff: skill.cutoff,
  crowd: crowd ? crowd.odds : null,
  market: market.odds,
  vig: market.vig,
  kl: div ? div.kl : null,
  entriesUsed: crowd ? crowd.entriesUsed : 0,
  posts,
};
mkdirSync(LIVE_DIR, { recursive: true });
appendFileSync(HISTORY, `${JSON.stringify(row)}\n`);

// ---- report --------------------------------------------------------------------------
console.log(
  `snapshot ${row.date} (skill cutoff ${skill.cutoff}, vig ${(market.vig * 100).toFixed(1)}%)`,
);
const header = crowd
  ? 'team   crowd    market   Δ'
  : 'team   market   (no live corpus yet — crowd side pending Reddit credentials)';
console.log(header);
for (const t of [...LIVE_SAGA.candidates].sort(
  (a, b) => (market.odds[b] ?? 0) - (market.odds[a] ?? 0),
)) {
  const m = `${(100 * market.odds[t]).toFixed(1)}%`.padStart(6);
  if (crowd) {
    const c = `${(100 * crowd.odds[t]).toFixed(1)}%`.padStart(6);
    const d = 100 * (crowd.odds[t] - market.odds[t]);
    console.log(`${t}   ${c}   ${m}   ${d >= 0 ? '+' : ''}${d.toFixed(1)}`);
  } else {
    console.log(`${t}   ${m}`);
  }
}
if (div) {
  console.log(
    `\nKL(crowd‖market) ${div.kl.toFixed(4)} nats · crowd top ${div.topCrowd} vs market top ${div.topMarket}${div.agree ? ' (agree)' : ' (DISAGREE)'}`,
  );
}
console.log(`appended to ${HISTORY}`);
