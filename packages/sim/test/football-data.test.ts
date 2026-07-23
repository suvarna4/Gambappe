/**
 * WS26-T15 ACs: de-vig math hand-checked, odds ladder prefers closing columns, malformed
 * rows skipped (never guessed), deterministic time synthesis, and the cutoff slicer is
 * strict — a World Cup date can never land in a pre-cutoff slice.
 */
import { describe, expect, it } from 'vitest';
import {
  buildDataset,
  devigHomeProb,
  parseFootballDataCsv,
  splitByCutoff,
  synthesizeTimeToLockMs,
} from '../src/football-data.js';

const MODERN_HEADER =
  'Div,Date,Time,HomeTeam,AwayTeam,FTR,B365H,B365D,B365A,PSH,PSD,PSA,PSCH,PSCD,PSCA';
const LEGACY_HEADER = 'Div,Date,HomeTeam,AwayTeam,FTR,B365H,B365D,B365A';

describe('devigHomeProb', () => {
  it('normalizes the overround proportionally', () => {
    // 1/2.0 + 1/3.5 + 1/4.0 = 1.0357…; home = 0.5 / total
    const total = 1 / 2.0 + 1 / 3.5 + 1 / 4.0;
    expect(devigHomeProb(2.0, 3.5, 4.0)).toBeCloseTo(0.5 / total, 10);
  });

  it('rejects impossible decimal odds (≤ 1) instead of producing junk', () => {
    expect(devigHomeProb(0, 3.5, 4)).toBeNull();
    expect(devigHomeProb(1, 3.5, 4)).toBeNull();
  });

  it('clamps to the app price band', () => {
    expect(devigHomeProb(1.01, 100, 100)).toBeLessThanOrEqual(0.99);
  });
});

describe('parseFootballDataCsv', () => {
  it('prefers Pinnacle CLOSING odds over earlier ladder rungs', () => {
    const csv = [
      MODERN_HEADER,
      // B365 says 2.0 home; Pinnacle closing says 4.0 — closing must win.
      'E0,15/08/2025,20:00,Liverpool,Bournemouth,H,2.0,3.5,4.0,2.1,3.4,3.9,4.0,3.5,2.0',
    ].join('\n');
    const [row] = parseFootballDataCsv(csv);
    const total = 1 / 4.0 + 1 / 3.5 + 1 / 2.0;
    expect(row!.yesPrice).toBeCloseTo(1 / 4.0 / total, 10);
    expect(row!.outcome).toBe('yes');
    expect(row!.kickoffDate).toBe('2025-08-15');
    expect(row!.category).toBe('sports');
  });

  it('falls back down the ladder on legacy files, and handles two-digit years + BOM', () => {
    const csv = ['﻿' + LEGACY_HEADER, 'E0,03/09/11,Arsenal,Swansea,A,1.5,4.2,7.0'].join('\n');
    const [row] = parseFootballDataCsv(csv);
    const total = 1 / 1.5 + 1 / 4.2 + 1 / 7.0;
    expect(row!.yesPrice).toBeCloseTo(1 / 1.5 / total, 10);
    expect(row!.outcome).toBe('no'); // away win → home-win market resolves no
    expect(row!.kickoffDate).toBe('2011-09-03');
  });

  it('skips malformed rows — bad dates, missing odds, unknown result tokens', () => {
    const csv = [
      LEGACY_HEADER,
      'E0,notadate,Arsenal,Swansea,H,1.5,4.2,7.0',
      'E0,03/09/11,Arsenal,Swansea,H,,,',
      'E0,03/09/11,Arsenal,Swansea,X,1.5,4.2,7.0',
      'E0,04/09/11,Chelsea,Norwich,D,1.4,4.5,8.0',
    ].join('\n');
    const rows = parseFootballDataCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.outcome).toBe('no'); // draw → home-win market resolves no
  });

  it('synthesizes deterministic, bounded time-to-lock from the row id alone', () => {
    const a = synthesizeTimeToLockMs('E0:2025-08-15:Liverpool v Bournemouth');
    expect(a).toBe(synthesizeTimeToLockMs('E0:2025-08-15:Liverpool v Bournemouth'));
    expect(a).toBeGreaterThanOrEqual(5 * 60_000);
    expect(a).toBeLessThanOrEqual(6 * 60 * 60_000);
    expect(synthesizeTimeToLockMs('some-other-match')).not.toBe(a);
  });
});

describe('cutoff discipline', () => {
  const mk = (kickoffDate: string) => ({
    id: `E0:${kickoffDate}:A v B`,
    category: 'sports' as const,
    yesPrice: 0.5,
    timeToLockMs: 60_000,
    outcome: 'yes' as const,
    kickoffDate,
  });

  it('splitByCutoff is strict: the cutoff day itself is held out', () => {
    const rows = [mk('2026-05-30'), mk('2026-05-31'), mk('2026-06-14')];
    const { train, held } = splitByCutoff(rows, '2026-05-31');
    expect(train.map((r) => r.kickoffDate)).toEqual(['2026-05-30']);
    expect(held.map((r) => r.kickoffDate)).toEqual(['2026-05-31', '2026-06-14']);
  });

  it('buildDataset stamps the cutoff and can never contain a World Cup match', () => {
    const rows = [mk('2026-05-01'), mk('2026-06-14'), mk('2026-07-19')];
    const dataset = buildDataset(rows, 'test', '2026-05-31', new Date('2026-07-23T00:00:00Z'));
    expect(dataset.cutoff).toBe('2026-05-31');
    expect(dataset.rows.map((r) => r.kickoffDate)).toEqual(['2026-05-01']);
    expect(dataset.rows.every((r) => r.kickoffDate < dataset.cutoff)).toBe(true);
  });
});
