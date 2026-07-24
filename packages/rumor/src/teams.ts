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
 * Full franchise names, lowercase, as market venues write them (WS27-T6): the join key
 * between Polymarket question strings ("Will LeBron James play for the Miami Heat…")
 * and team codes. Aliases listed per team; first is canonical.
 */
export const TEAM_FULL_NAMES: Record<NbaTeam, string[]> = {
  ATL: ['atlanta hawks'],
  BOS: ['boston celtics'],
  BKN: ['brooklyn nets'],
  CHA: ['charlotte hornets'],
  CHI: ['chicago bulls'],
  CLE: ['cleveland cavaliers'],
  DAL: ['dallas mavericks'],
  DEN: ['denver nuggets'],
  DET: ['detroit pistons'],
  GSW: ['golden state warriors'],
  HOU: ['houston rockets'],
  IND: ['indiana pacers'],
  LAC: ['los angeles clippers', 'la clippers'],
  LAL: ['los angeles lakers', 'la lakers'],
  MEM: ['memphis grizzlies'],
  MIA: ['miami heat'],
  MIL: ['milwaukee bucks'],
  MIN: ['minnesota timberwolves'],
  NOP: ['new orleans pelicans'],
  NYK: ['new york knicks'],
  OKC: ['oklahoma city thunder'],
  ORL: ['orlando magic'],
  PHI: ['philadelphia 76ers'],
  PHX: ['phoenix suns'],
  POR: ['portland trail blazers'],
  SAC: ['sacramento kings'],
  SAS: ['san antonio spurs'],
  TOR: ['toronto raptors'],
  UTA: ['utah jazz'],
  WAS: ['washington wizards'],
};

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
