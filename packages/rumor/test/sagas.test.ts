import { describe, expect, it } from 'vitest';

import { SAGAS, getSagaById, isNbaTeam } from '../src/index.js';

describe('saga manifest', () => {
  it('every saga is internally consistent', () => {
    for (const saga of SAGAS) {
      // Outcome must be one of the candidates the aggregation normalizes over.
      expect(saga.candidates, saga.id).toContain(saga.outcome);
      expect(new Set(saga.candidates).size, saga.id).toBe(saga.candidates.length);
      expect(saga.candidates.every(isNbaTeam), saga.id).toBe(true);
      // Window ordering, and resolution at the window's end (replay stops before it).
      expect(saga.from < saga.to, saga.id).toBe(true);
      expect(saga.resolvedAt, saga.id).toBe(saga.to);
      // Pushshift-era only: real comment upvotes require pre-2023 archives (plan §1).
      expect(saga.to < '2023-01-01', saga.id).toBe(true);
      expect(saga.subreddits.length, saga.id).toBeGreaterThan(0);
      expect(saga.subreddits, saga.id).toContain('nba');
      expect(saga.titleQuery, saga.id).toBe(saga.titleQuery.toLowerCase());
    }
  });

  it('has unique ids and the six planned sagas', () => {
    const ids = SAGAS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([
      'lebron-2014',
      'kd-2016',
      'lebron-2018',
      'kyrie-2019',
      'kawhi-2019',
      'harden-2021',
    ]);
  });

  it('pins the known outcomes', () => {
    expect(getSagaById('lebron-2014')?.outcome).toBe('CLE');
    expect(getSagaById('kd-2016')?.outcome).toBe('GSW');
    expect(getSagaById('lebron-2018')?.outcome).toBe('LAL');
    expect(getSagaById('kyrie-2019')?.outcome).toBe('BKN');
    expect(getSagaById('kawhi-2019')?.outcome).toBe('LAC');
    expect(getSagaById('harden-2021')?.outcome).toBe('BKN');
    expect(getSagaById('nope')).toBeNull();
  });
});
