/**
 * Resolved-saga manifest (docs/plans/ws27-rumor-radar.md §2A, WS27-T1) — the training and
 * backtest corpus definition. Every saga here RESOLVED years ago with a publicly known
 * outcome, and its Reddit corpus lives in the Pushshift-era archive where comment upvotes
 * are real (plan §1 verified facts). Windows end at the resolution date: the WS27-T4
 * walk-forward harness replays days strictly before `resolvedAt`, so post-announcement
 * confirmation chatter never masquerades as prediction.
 *
 * `candidates` is the closed set of destinations the aggregation normalizes over for that
 * saga — teams contemporary coverage treated as live options, incumbent included. The
 * outcome is always a member of `candidates` (pinned by test).
 */
import type { NbaTeam } from './teams.js';

export interface SagaDef {
  /** Stable id — also the corpus directory name (data/<id>/<postId>.json). */
  id: string;
  player: string;
  /** Title search term for post discovery (case-insensitive substring, Arctic Shift `title`). */
  titleQuery: string;
  /** Subreddits swept for the corpus: league sub + the fanbases in the story. */
  subreddits: string[];
  /** Corpus window (inclusive, YYYY-MM-DD): rumor season start → resolution date. */
  from: string;
  to: string;
  /** The day the decision became public — replay grades days strictly before this. */
  resolvedAt: string;
  candidates: NbaTeam[];
  outcome: NbaTeam;
}

export const SAGAS: SagaDef[] = [
  {
    id: 'lebron-2014',
    player: 'LeBron James',
    titleQuery: 'lebron',
    subreddits: ['nba', 'clevelandcavs', 'heat', 'chicagobulls'],
    from: '2014-06-25',
    to: '2014-07-11',
    resolvedAt: '2014-07-11',
    candidates: ['MIA', 'CLE', 'CHI', 'LAL', 'HOU'],
    outcome: 'CLE',
  },
  {
    id: 'kd-2016',
    player: 'Kevin Durant',
    titleQuery: 'durant',
    subreddits: ['nba', 'thunder', 'warriors', 'bostonceltics', 'rockets'],
    from: '2016-06-20',
    to: '2016-07-04',
    resolvedAt: '2016-07-04',
    candidates: ['OKC', 'GSW', 'BOS', 'SAS', 'MIA', 'LAC'],
    outcome: 'GSW',
  },
  {
    id: 'lebron-2018',
    player: 'LeBron James',
    titleQuery: 'lebron',
    subreddits: ['nba', 'lakers', 'clevelandcavs', 'sixers', 'rockets'],
    from: '2018-06-25',
    to: '2018-07-01',
    resolvedAt: '2018-07-01',
    candidates: ['CLE', 'LAL', 'PHI', 'HOU', 'BOS'],
    outcome: 'LAL',
  },
  {
    id: 'kyrie-2019',
    player: 'Kyrie Irving',
    titleQuery: 'kyrie',
    subreddits: ['nba', 'bostonceltics', 'gonets', 'nyknicks'],
    from: '2019-06-15',
    to: '2019-06-30',
    resolvedAt: '2019-06-30',
    candidates: ['BOS', 'BKN', 'NYK', 'LAL'],
    outcome: 'BKN',
  },
  {
    id: 'kawhi-2019',
    player: 'Kawhi Leonard',
    titleQuery: 'kawhi',
    subreddits: ['nba', 'torontoraptors', 'lakers', 'laclippers'],
    from: '2019-06-25',
    to: '2019-07-06',
    resolvedAt: '2019-07-06',
    candidates: ['TOR', 'LAC', 'LAL'],
    outcome: 'LAC',
  },
  {
    id: 'harden-2021',
    player: 'James Harden',
    titleQuery: 'harden',
    subreddits: ['nba', 'rockets', 'gonets', 'sixers'],
    from: '2020-12-01',
    to: '2021-01-13',
    resolvedAt: '2021-01-13',
    candidates: ['HOU', 'BKN', 'PHI', 'MIA', 'BOS'],
    outcome: 'BKN',
  },
];

export function getSagaById(id: string): SagaDef | null {
  return SAGAS.find((s) => s.id === id) ?? null;
}
