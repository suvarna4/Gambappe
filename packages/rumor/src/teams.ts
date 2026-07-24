/**
 * NBA team codes (docs/plans/ws27-rumor-radar.md §5, WS27-T1). The stable vocabulary every
 * later stage speaks: saga outcomes (this task), the extractor's alias lexicon (WS27-T2),
 * aggregated odds keys (WS27-T3), and market-comparison joins (WS27-T6) all use these codes.
 * The full alias lexicon (nicknames, cities, indirect refs) is WS27-T2's deliverable — only
 * the code vocabulary lives here.
 */
export const NBA_TEAMS = [
  'ATL',
  'BOS',
  'BKN',
  'CHA',
  'CHI',
  'CLE',
  'DAL',
  'DEN',
  'DET',
  'GSW',
  'HOU',
  'IND',
  'LAC',
  'LAL',
  'MEM',
  'MIA',
  'MIL',
  'MIN',
  'NOP',
  'NYK',
  'OKC',
  'ORL',
  'PHI',
  'PHX',
  'POR',
  'SAC',
  'SAS',
  'TOR',
  'UTA',
  'WAS',
] as const;

export type NbaTeam = (typeof NBA_TEAMS)[number];

export function isNbaTeam(value: unknown): value is NbaTeam {
  return typeof value === 'string' && (NBA_TEAMS as readonly string[]).includes(value);
}

/**
 * Each team's fan subreddit(s), lowercase — the homer-discount lookup (WS27-T3): a
 * comment boosting a team from inside that team's own sub counts for less.
 */
export const TEAM_SUBREDDITS: Record<NbaTeam, string[]> = {
  ATL: ['atlantahawks'],
  BOS: ['bostonceltics'],
  BKN: ['gonets'],
  CHA: ['charlottehornets'],
  CHI: ['chicagobulls'],
  CLE: ['clevelandcavs'],
  DAL: ['mavericks'],
  DEN: ['denvernuggets'],
  DET: ['detroitpistons'],
  GSW: ['warriors'],
  HOU: ['rockets'],
  IND: ['pacers'],
  LAC: ['laclippers'],
  LAL: ['lakers'],
  MEM: ['memphisgrizzlies'],
  MIA: ['heat'],
  MIL: ['mkebucks'],
  MIN: ['timberwolves'],
  NOP: ['nolapelicans'],
  NYK: ['nyknicks'],
  OKC: ['thunder'],
  ORL: ['orlandomagic'],
  PHI: ['sixers'],
  PHX: ['suns'],
  POR: ['ripcity'],
  SAC: ['kings'],
  SAS: ['nbaspurs'],
  TOR: ['torontoraptors'],
  UTA: ['utahjazz'],
  WAS: ['washingtonwizards'],
};
