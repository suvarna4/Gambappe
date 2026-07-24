#!/usr/bin/env node
/**
 * Run the walk-forward backtest over the fetched saga corpus (WS27-T4). Replays every
 * saga with snapshots on disk through the UNTRAINED default skill and prints per-saga
 * and aggregate scores — the baseline every trained skill (WS27-T5) must beat.
 *
 * Requires the build first: pnpm --filter @receipts/rumor build
 * Run from packages/rumor: node scripts/backtest.mjs [sagaId ...]
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SAGAS,
  defaultRumorSkill,
  isPostSnapshot,
  replaySaga,
  skillPolicy,
  snapshotEntries,
} from '../dist/index.js';

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');

export function loadSagaEntries(sagaId) {
  const dir = join(DATA_DIR, sagaId);
  if (!existsSync(dir)) return null;
  const entries = [];
  for (const file of readdirSync(dir)) {
    const parsed = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    if (!isPostSnapshot(parsed)) {
      console.warn(`  skipping invalid snapshot ${sagaId}/${file}`);
      continue;
    }
    entries.push(...snapshotEntries(parsed));
  }
  return entries;
}

const only = process.argv.slice(2);
const targets = only.length > 0 ? SAGAS.filter((s) => only.includes(s.id)) : SAGAS;
const policy = skillPolicy(defaultRumorSkill('untrained'), 'untrained');

let sumFinalLogLoss = 0;
let sumMeanLogLoss = 0;
let ranked1 = 0;
let replayed = 0;

for (const saga of targets) {
  const entries = loadSagaEntries(saga.id);
  if (entries === null) {
    console.log(`${saga.id}: no corpus on disk — skipped (run fetch-sagas.mjs first)`);
    continue;
  }
  const report = replaySaga(saga, entries, policy);
  replayed += 1;
  sumFinalLogLoss += report.final.logLoss;
  sumMeanLogLoss += report.meanLogLoss;
  if (report.final.outcomeRank === 1) ranked1 += 1;

  const finalOdds = Object.entries(report.final.odds.odds)
    .sort((a, b) => b[1] - a[1])
    .map(([t, p]) => `${t} ${(100 * p).toFixed(1)}%`)
    .join(' | ');
  console.log(
    `${saga.id.padEnd(12)} → ${saga.outcome}  final rank #${report.final.outcomeRank}  ` +
      `final logLoss ${report.final.logLoss.toFixed(3)}  mean ${report.meanLogLoss.toFixed(3)}  ` +
      `brier ${report.final.brier.toFixed(3)}  (${report.days.length} days)`,
  );
  console.log(`  eve odds: ${finalOdds}`);
}

if (replayed > 0) {
  console.log(
    `\naggregate over ${replayed} sagas: outcome ranked #1 on ${ranked1}/${replayed}, ` +
      `Σ final logLoss ${sumFinalLogLoss.toFixed(3)}, Σ mean logLoss ${sumMeanLogLoss.toFixed(3)}`,
  );
}
