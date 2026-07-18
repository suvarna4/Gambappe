/** §7.17: closed set of allowed client-relayed event names. */
export const ALLOWED_EVENT_NAMES = [
  "spectator_view",
  "ghost_minted",
  "pick_created",
  "claim_prompt_shown",
  "claim_completed",
  "reveal_attended",
  "card_shared",
  "card_view",
  "nemesis_week_completed",
  "report_filed",
] as const;

export type AllowedEventName = (typeof ALLOWED_EVENT_NAMES)[number];
