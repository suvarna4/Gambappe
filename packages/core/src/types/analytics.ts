/**
 * Canonical first-party analytics event names (design doc §13.1).
 * Unknown events are dropped at ingestion; this union is the typed catalog.
 */

export const ANALYTICS_EVENTS = [
  'spectator_view',
  'ghost_minted',
  'pick_created',
  'pick_undone',
  'share_card_generated',
  'share_completed',
  'spectator_cta_click',
  'claim_prompt_shown',
  'claim_completed',
  'reveal_attended',
  'placement_started',
  'placement_completed',
  'nemesis_viewed',
  'rematch_requested',
  'duo_enqueued',
  'duo_page_viewed',
  'chemistry_viewed',
  'thread_posted',
  'reaction_added',
  'venue_outbound_click',
  'wallet_linked',
  'wallet_unlinked',
  'report_filed',
  'block_created',
  'streak_freeze_used',
  'notification_opened',
] as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[number];

export function isAnalyticsEventName(value: string): value is AnalyticsEventName {
  return (ANALYTICS_EVENTS as readonly string[]).includes(value);
}
