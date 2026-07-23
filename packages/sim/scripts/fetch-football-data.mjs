// WS26-T15 runtime fetcher (docs/plans/cpu-nemesis-wbs.md): downloads football-data.co.uk
// season CSVs, normalizes them through the tested parser, and writes ONE cutoff-stamped
// JSONL artifact per slice into packages/sim/data/ (gitignored — data is fetched, never
// committed). Train cutoff 2026-05-31 is the pre-World-Cup wall; the validation slice is
// the late 2025/26 club season (2026-01-01 .. cutoff), where ALL tuning happens.
//
// Usage: node scripts/fetch-football-data.mjs   (from packages/sim; Node 22+, built dist/)
import { mkdir, writeFile } from 'node:fs/promises';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
import { buildDataset, parseFootballDataCsv, splitByCutoff } from '../dist/football-data.js';

// Sandboxed/CI environments route egress through an HTTPS proxy; Node's fetch ignores the
// proxy env vars unless told. No-op when no proxy is configured.
setGlobalDispatcher(new EnvHttpProxyAgent());

const BASE = 'https://www.football-data.co.uk/mmz4281';
// Top divisions with deep odds coverage; ~16 seasons each.
const LEAGUES = ['E0', 'E1', 'D1', 'I1', 'SP1', 'F1'];
const SEASONS = [];
for (let start = 10; start <= 25; start++) {
  SEASONS.push(`${String(start).padStart(2, '0')}${String(start + 1).padStart(2, '0')}`);
}

const TRAIN_CUTOFF = '2026-05-31'; // strictly pre-World-Cup
const VALIDATION_START = '2026-01-01'; // late 2025/26 club season → tuning slice

const all = [];
let files = 0;
for (const season of SEASONS) {
  for (const league of LEAGUES) {
    const url = `${BASE}/${season}/${league}.csv`;
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`skip ${url}: ${res.status}`);
      continue;
    }
    const rows = parseFootballDataCsv(await res.text());
    all.push(...rows);
    files += 1;
  }
}

// Drop dupes across overlapping files (id is div:date:fixture — stable).
const byId = new Map(all.map((r) => [r.id, r]));
const rows = [...byId.values()].sort((a, b) => a.kickoffDate.localeCompare(b.kickoffDate));

const now = new Date();
const wall = buildDataset(rows, `football-data.co.uk ${LEAGUES.join(',')}`, TRAIN_CUTOFF, now);
const { train, held: validation } = splitByCutoff(wall.rows, VALIDATION_START);

await mkdir(new URL('../data/', import.meta.url), { recursive: true });
const write = (name, dataset) =>
  writeFile(
    new URL(`../data/${name}.jsonl`, import.meta.url),
    [
      JSON.stringify({
        meta: {
          source: wall.source,
          cutoff: dataset.cutoff,
          generatedAt: wall.generatedAt,
          rows: dataset.rows.length,
        },
      }),
      ...dataset.rows.map((r) => JSON.stringify(r)),
    ].join('\n'),
  );

await write('train', { cutoff: VALIDATION_START, rows: train });
await write('validation', { cutoff: TRAIN_CUTOFF, rows: validation });

console.log(
  JSON.stringify(
    {
      files,
      totalRows: rows.length,
      train: train.length,
      validation: validation.length,
      firstKickoff: rows[0]?.kickoffDate,
      lastKickoff: rows[rows.length - 1]?.kickoffDate,
      trainCutoff: TRAIN_CUTOFF,
      validationStart: VALIDATION_START,
    },
    null,
    2,
  ),
);
