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
