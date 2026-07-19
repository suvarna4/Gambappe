/**
 * WS9-T3 (§13.3): pure unit tests for `deriveRevealBeats` — the beat-selection logic reveal:fire
 * hooks into. Deliberately DB-free (per the task's "favor unit-testing the beat-selection/dedupe-
 * key logic as pure-ish functions" guidance) so it's checkable without a live Postgres.
 *
 * SW9-T1 (obituary-handoff §3.3(4)): `streak_busted` is re-keyed onto the replay-derived wake
 * signal (`runs.length > 0 && currentRunStartedOn === questionDate`, dead run length >= 3) —
 * NOT the live `profiles.current_streak` diff, which `streak:sweep` zeroes the day before in
 * the normal flow. These unit tests pin the pure selection logic; the trigger-semantics proof
 * (real reveal against really-seeded Postgres history, incl. the sweep-ordering case) lives in
 * `test/integration/streak-busted-wake.test.ts` per the doc's §1 no-mock rule.
 */
import { describe, expect, it } from 'vitest';
import { deriveRevealBeats, type RevealBeatInput } from '../src/notifications/reveal-beats.js';

const base: RevealBeatInput = {
  profileId: 'profile-1',
  handle: 'shortstacker',
  questionDate: '2026-08-13',
  currentStreak: 1,
  runs: [],
  currentRunStartedOn: '2026-08-13',
  freezeUsedForGap: false,
  freezeBankAfter: 0,
  calledIt: false,
  impliedProbability: 0.5,
};

/** Wake-shaped replay fields: a dead run of `length`, live run started `questionDate` (today). */
function wake(length: number, endedOn = '2026-08-10'): Pick<RevealBeatInput, 'runs' | 'currentRunStartedOn' | 'currentStreak'> {
  return {
    runs: [{ length, startedOn: '2026-08-01', endedOn }],
    currentRunStartedOn: '2026-08-13',
    currentStreak: 1, // in-order wake: the live run started today (the late-reveal edge can differ)
  };
}

describe('deriveRevealBeats (§13.3)', () => {
  it('fires nothing for a plain, non-milestone, non-longshot participation', () => {
    expect(deriveRevealBeats(base)).toEqual([]);
  });

  it.each([3, 7, 14, 30] as const)('fires streak_milestone at n=%i', (n) => {
    const beats = deriveRevealBeats({ ...base, currentStreak: n, currentRunStartedOn: '2026-08-01' });
    expect(beats).toHaveLength(1);
    expect(beats[0]).toMatchObject({ kind: 'streak_milestone', payload: { n } });
    expect(beats[0]!.dedupeKey).toBe(`streak_milestone:2026-08-13:profile-1`);
    expect(beats[0]!.line).toContain(String(n));
  });

  it('does not fire streak_milestone for a non-milestone streak length', () => {
    const beats = deriveRevealBeats({ ...base, currentStreak: 5, currentRunStartedOn: '2026-08-09' });
    expect(beats).toEqual([]);
  });

  it('fires streak_busted at the wake (dead run >= 3, live run started today), n = dead run length', () => {
    const beats = deriveRevealBeats({ ...base, ...wake(5) });
    expect(beats).toHaveLength(1);
    // §3.3(4) narration-length rule: `n` is the DEAD RUN's length, matching the obituary card.
    expect(beats[0]).toMatchObject({ kind: 'streak_busted', payload: { n: 5 } });
    // Death-scoped dedupe: the DEAD RUN's endedOn, not the revealing question's date.
    expect(beats[0]!.dedupeKey).toBe(`streak_busted:2026-08-10:profile-1`);
    expect(beats[0]!.line).toContain('5-day streak');
  });

  it('dedupes one death across two wakes: an out-of-order backfilled reveal reuses the same key', () => {
    // The PR #79 review's finding-1 scenario, at the pure-selection layer: the wake first fires
    // from day D's reveal; a lagging earlier daily (D-3) then reveals late, backfilled history
    // moves the live run's start to D-3, and THAT reveal satisfies the wake condition again for
    // the SAME dead run. The two firings must share a dedupe key so the outbox unique
    // constraint collapses them into one notification.
    const atD = deriveRevealBeats({ ...base, ...wake(5), questionDate: '2026-08-13', currentRunStartedOn: '2026-08-13' });
    const backfilled = deriveRevealBeats({
      ...base,
      ...wake(5),
      questionDate: '2026-08-11',
      currentRunStartedOn: '2026-08-11',
      currentStreak: 3,
    });
    expect(atD).toHaveLength(1);
    expect(backfilled).toHaveLength(1);
    expect(backfilled[0]!.dedupeKey).toBe(atD[0]!.dedupeKey);
    // ...and the backfilled wake wins over a same-day milestone (documented else-if behavior).
    expect(backfilled[0]!.kind).toBe('streak_busted');
  });

  it('does NOT fire streak_busted for a dead run < 3 (never had a real streak to bust)', () => {
    const beats = deriveRevealBeats({ ...base, ...wake(2) });
    expect(beats).toEqual([]);
  });

  it('does NOT fire streak_busted outside the wake (live run did not start today)', () => {
    // Dead run exists, but the viewer came back YESTERDAY — the funeral already happened.
    const beats = deriveRevealBeats({
      ...base,
      runs: [{ length: 5, startedOn: '2026-08-01', endedOn: '2026-08-10' }],
      currentRunStartedOn: '2026-08-12',
      currentStreak: 2,
    });
    expect(beats).toEqual([]);
  });

  it('does NOT fire streak_busted with no completed runs (first-ever pick — the §3.1 zero-guard exclusion)', () => {
    const beats = deriveRevealBeats({ ...base, runs: [], currentRunStartedOn: '2026-08-13', currentStreak: 1 });
    expect(beats).toEqual([]);
  });

  it('mourns only the LATEST death: n comes from runs.at(-1)', () => {
    const beats = deriveRevealBeats({
      ...base,
      runs: [
        { length: 7, startedOn: '2026-07-20', endedOn: '2026-07-26' },
        { length: 4, startedOn: '2026-08-01', endedOn: '2026-08-04' },
      ],
      currentRunStartedOn: '2026-08-13',
      currentStreak: 1,
    });
    expect(beats).toHaveLength(1);
    expect(beats[0]).toMatchObject({ kind: 'streak_busted', payload: { n: 4 } });
  });

  it('streak_busted and streak_milestone are mutually exclusive (the wake always lands on 1, milestones start at 3)', () => {
    const beats = deriveRevealBeats({ ...base, ...wake(3) });
    expect(beats.map((b) => b.kind)).toEqual(['streak_busted']);
  });

  it('fires streak_freeze_used when a freeze was newly consumed for this gap, with the post-consumption bank', () => {
    const beats = deriveRevealBeats({ ...base, freezeUsedForGap: true, freezeBankAfter: 1 });
    expect(beats).toHaveLength(1);
    expect(beats[0]).toMatchObject({ kind: 'streak_freeze_used', payload: { freezesLeft: 1 } });
    expect(beats[0]!.dedupeKey).toBe(`streak_freeze_used:2026-08-13:profile-1`);
    expect(beats[0]!.line).toContain('1 left');
  });

  it('fires called_it for a longshot win, independent of streak state', () => {
    const beats = deriveRevealBeats({ ...base, calledIt: true, impliedProbability: 0.2 });
    expect(beats).toHaveLength(1);
    expect(beats[0]).toMatchObject({ kind: 'called_it', payload: { impliedProbability: 0.2 } });
    expect(beats[0]!.dedupeKey).toBe(`called_it:2026-08-13:profile-1`);
    expect(beats[0]!.line).toContain('shortstacker');
  });

  it('multiple independent beats can co-fire off one reveal, each with its own dedupe key', () => {
    const beats = deriveRevealBeats({
      ...base,
      freezeUsedForGap: true,
      freezeBankAfter: 0,
      currentStreak: 3, // bridged gap day, then this reveal lands exactly on milestone 3
      currentRunStartedOn: '2026-08-11',
      calledIt: true,
      impliedProbability: 0.1,
    });
    expect(beats.map((b) => b.kind).sort()).toEqual(['called_it', 'streak_freeze_used', 'streak_milestone'].sort());
    const dedupeKeys = new Set(beats.map((b) => b.dedupeKey));
    expect(dedupeKeys.size).toBe(beats.length); // all distinct
  });

  it('dedupe keys are deterministic and vary by beat/date/profile', () => {
    const milestone = { currentStreak: 3, currentRunStartedOn: '2026-08-11' };
    const a = deriveRevealBeats({ ...base, ...milestone })[0]!;
    const b = deriveRevealBeats({ ...base, ...milestone })[0]!;
    expect(a.dedupeKey).toBe(b.dedupeKey); // same inputs -> same key (idempotent by construction)

    const otherProfile = deriveRevealBeats({ ...base, ...milestone, profileId: 'profile-2' })[0]!;
    expect(otherProfile.dedupeKey).not.toBe(a.dedupeKey);

    const otherDate = deriveRevealBeats({ ...base, ...milestone, questionDate: '2026-08-14' })[0]!;
    expect(otherDate.dedupeKey).not.toBe(a.dedupeKey);
  });
});
