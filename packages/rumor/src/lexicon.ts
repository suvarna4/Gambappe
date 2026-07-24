/**
 * Built-in team-alias lexicon (docs/plans/ws27-rumor-radar.md §2B, WS27-T2). Maps
 * lowercase alias phrases → team codes. Multi-word phrases are matched as token
 * sequences by the extractor, with word boundaries — "warrior" never matches "warriors".
 *
 * Deliberately global-only: aliases here must be unambiguous in ANY NBA conversation.
 * Saga-dependent refs ("homecoming" means CLE only in a LeBron saga) belong in the
 * skill's `lexiconDeltas` (WS27-T3), passed in via `extraAliases`. Genuinely ambiguous
 * strings ("la", "los angeles", "new york" alone is kept because the Knicks dominate that
 * usage — Nets talk says "brooklyn") are either omitted or assigned to their dominant
 * reading; the skill can override any entry.
 */
import type { NbaTeam } from './teams.js';

export const TEAM_ALIASES: Record<string, NbaTeam> = {
  // Nicknames
  hawks: 'ATL',
  celtics: 'BOS',
  nets: 'BKN',
  hornets: 'CHA',
  bulls: 'CHI',
  cavs: 'CLE',
  cavaliers: 'CLE',
  mavs: 'DAL',
  mavericks: 'DAL',
  nuggets: 'DEN',
  pistons: 'DET',
  warriors: 'GSW',
  dubs: 'GSW',
  rockets: 'HOU',
  pacers: 'IND',
  clippers: 'LAC',
  clips: 'LAC',
  lakers: 'LAL',
  grizzlies: 'MEM',
  grizz: 'MEM',
  heat: 'MIA',
  bucks: 'MIL',
  timberwolves: 'MIN',
  wolves: 'MIN',
  pelicans: 'NOP',
  pels: 'NOP',
  knicks: 'NYK',
  thunder: 'OKC',
  magic: 'ORL',
  sixers: 'PHI',
  '76ers': 'PHI',
  suns: 'PHX',
  'trail blazers': 'POR',
  blazers: 'POR',
  kings: 'SAC',
  spurs: 'SAS',
  raptors: 'TOR',
  raps: 'TOR',
  jazz: 'UTA',
  wizards: 'WAS',
  // Cities / regions (unambiguous ones only)
  atlanta: 'ATL',
  boston: 'BOS',
  brooklyn: 'BKN',
  charlotte: 'CHA',
  chicago: 'CHI',
  cleveland: 'CLE',
  dallas: 'DAL',
  denver: 'DEN',
  detroit: 'DET',
  'golden state': 'GSW',
  houston: 'HOU',
  indiana: 'IND',
  memphis: 'MEM',
  miami: 'MIA',
  milwaukee: 'MIL',
  minnesota: 'MIN',
  'new orleans': 'NOP',
  'new york': 'NYK',
  'oklahoma city': 'OKC',
  okc: 'OKC',
  orlando: 'ORL',
  philadelphia: 'PHI',
  philly: 'PHI',
  phoenix: 'PHX',
  portland: 'POR',
  sacramento: 'SAC',
  'san antonio': 'SAS',
  toronto: 'TOR',
  utah: 'UTA',
  washington: 'WAS',
  // Indirect but globally unambiguous refs
  'south beach': 'MIA',
  'the land': 'CLE',
  'the bay': 'GSW',
  'bay area': 'GSW',
  'chi town': 'CHI',
  'big apple': 'NYK',
  'city of brotherly love': 'PHI',
  'the six': 'TOR',
  'the 6': 'TOR',
};

/** Longest-first alias list — the extractor matches greedily so 'trail blazers' beats 'blazers'. */
export function aliasesLongestFirst(
  extra?: Record<string, NbaTeam>,
): Array<{ alias: string; team: NbaTeam; tokens: string[] }> {
  const merged: Record<string, NbaTeam> = { ...TEAM_ALIASES, ...extra };
  return Object.entries(merged)
    .map(([alias, team]) => ({ alias, team, tokens: alias.split(' ') }))
    .sort((a, b) => b.tokens.length - a.tokens.length || a.alias.localeCompare(b.alias));
}
