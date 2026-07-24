import { describe, expect, it } from 'vitest';

import {
  DEFAULT_STANCE_CUES,
  MENTION_BASE_CONFIDENCE,
  MENTION_BASE_STANCE,
  TEAM_ALIASES,
  extractTeamStances,
  isNbaTeam,
} from '../src/index.js';

const stanceFor = (text: string, team: string) =>
  extractTeamStances(text).find((s) => s.team === team);

describe('lexicon', () => {
  it('maps every alias to a real team code', () => {
    for (const [alias, team] of Object.entries(TEAM_ALIASES)) {
      expect(isNbaTeam(team), alias).toBe(true);
      expect(alias).toBe(alias.toLowerCase());
    }
  });

  it('covers all 30 teams', () => {
    expect(new Set(Object.values(TEAM_ALIASES)).size).toBe(30);
  });
});

describe('extractTeamStances — the plan §"examples to verify" set', () => {
  it('reads "leverage" as negative and keeps the other team positive (real comment)', () => {
    // Real comment from the 8,880-upvote Miami thread (plan §1): one comment, two teams,
    // opposite signs.
    const text =
      "LeBron uses the Warriors as leverage. Miami tanks LeBron's value by leaking that they've already got him.";
    const gsw = stanceFor(text, 'GSW');
    const mia = stanceFor(text, 'MIA');
    expect(gsw).toBeDefined();
    expect(gsw!.stance).toBeLessThan(0);
    expect(mia).toBeDefined();
    expect(mia!.stance).toBeGreaterThan(0);
  });

  it('flips stance under negation', () => {
    const mia = stanceFor("He's not going to Miami", 'MIA');
    expect(mia).toBeDefined();
    expect(mia!.stance).toBeLessThan(0);
    // Unnegated twin is positive.
    expect(stanceFor("He's going to Miami", 'MIA')!.stance).toBeGreaterThan(0);
  });

  it('reads "leaving the lakers" as negative — the naive-v0 flagship failure', () => {
    const lal = stanceFor("He's leaving the Lakers this summer", 'LAL');
    expect(lal).toBeDefined();
    expect(lal!.stance).toBeLessThan(0);
  });

  it('halves confidence under a hypothetical', () => {
    const firm = stanceFor('He goes to Boston', 'BOS')!;
    const iffy = stanceFor('If he goes to Boston', 'BOS')!;
    expect(iffy.stance).toBeCloseTo(firm.stance, 5);
    expect(iffy.confidence).toBeCloseTo(firm.confidence / 2, 5);
  });

  it('returns [] for no-signal comments', () => {
    expect(extractTeamStances("Shouldn't the league be investigating this?")).toEqual([]);
    expect(extractTeamStances('')).toEqual([]);
    expect(extractTeamStances('lol')).toEqual([]);
  });

  it('bare mention is weak positive at low confidence', () => {
    const cle = stanceFor('Cleveland though', 'CLE')!;
    expect(cle.stance).toBeCloseTo(MENTION_BASE_STANCE, 5);
    expect(cle.confidence).toBeCloseTo(MENTION_BASE_CONFIDENCE, 5);
  });

  it('sarcasm marker flips and dampens', () => {
    const straight = stanceFor("He's definitely signing with the Knicks", 'NYK')!;
    const sarcastic = stanceFor("He's definitely signing with the Knicks /s", 'NYK')!;
    expect(straight.stance).toBeGreaterThan(0);
    expect(sarcastic.stance).toBeLessThan(0);
    expect(Math.abs(sarcastic.stance)).toBeLessThan(Math.abs(straight.stance));
  });
});

describe('extractTeamStances — mechanics', () => {
  it('matches multi-word aliases greedily with word boundaries', () => {
    const stances = extractTeamStances('the trail blazers and golden state are out');
    expect(stances.map((s) => s.team)).toEqual(['GSW', 'POR']);
    // "warrior" (singular) must not match "warriors".
    expect(extractTeamStances('he is a warrior')).toEqual([]);
  });

  it('emits both teams for "cavs or lakers"', () => {
    const teams = extractTeamStances('Cavs or Lakers, nothing else makes sense').map((s) => s.team);
    expect(teams).toEqual(['CLE', 'LAL']);
  });

  it('indirect refs resolve (south beach → MIA)', () => {
    expect(stanceFor("He's taking his talents to South Beach", 'MIA')).toBeDefined();
  });

  it('supports skill lexicon deltas via extraAliases', () => {
    const none = extractTeamStances('the homecoming narrative writes itself');
    expect(none).toEqual([]);
    const withDelta = extractTeamStances('the homecoming narrative writes itself', {
      extraAliases: { homecoming: 'CLE' },
    });
    expect(withDelta.map((s) => s.team)).toEqual(['CLE']);
  });

  it('supports skill cue-weight overrides', () => {
    const custom = extractTeamStances('lebron bound for Miami', {
      cueWeights: { 'bound for': 0.9 },
    });
    expect(custom.find((s) => s.team === 'MIA')!.stance).toBeCloseTo(0.9, 5);
  });

  it('aggregates repeat mentions with confidence-weighted mean and is deterministic', () => {
    const text = 'Miami is the frontrunner. Miami has agreed. done deal for Miami.';
    const a = extractTeamStances(text);
    const b = extractTeamStances(text);
    expect(a).toEqual(b);
    expect(a).toHaveLength(1);
    expect(a[0]!.team).toBe('MIA');
    expect(a[0]!.stance).toBeGreaterThan(0.5);
    expect(a[0]!.confidence).toBeGreaterThan(0.5);
  });

  it('clamps stance to [−1, 1] even when cues stack', () => {
    const text = 'signing with joining headed to Miami has agreed done deal confirmed';
    const mia = stanceFor(text, 'MIA')!;
    expect(mia.stance).toBeLessThanOrEqual(1);
    expect(mia.stance).toBeGreaterThanOrEqual(-1);
  });

  it('default cue table stays lowercase (matcher contract)', () => {
    for (const phrase of Object.keys(DEFAULT_STANCE_CUES)) {
      expect(phrase).toBe(phrase.toLowerCase());
    }
  });
});
