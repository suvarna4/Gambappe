/**
 * Enums mirrored 1:1 from the Postgres enums (design doc §5.1).
 * `packages/db` defines the PG enums from these arrays — one source of truth.
 */

export const PROFILE_KIND = ['ghost', 'claimed'] as const;
export type ProfileKind = (typeof PROFILE_KIND)[number];

export const PROFILE_STATUS = ['active', 'paused_matchmaking', 'suspended', 'deleted'] as const;
export type ProfileStatus = (typeof PROFILE_STATUS)[number];

export const VENUE = ['kalshi', 'polymarket'] as const;
export type Venue = (typeof VENUE)[number];

export const MARKET_CATEGORY = [
  'sports',
  'politics',
  'economics',
  'culture',
  'science',
  'other',
] as const;
export type MarketCategory = (typeof MARKET_CATEGORY)[number];

export const MARKET_STATUS = ['open', 'closed', 'resolved', 'voided'] as const;
export type MarketStatus = (typeof MARKET_STATUS)[number];

export const MARKET_SIDE = ['yes', 'no'] as const;
export type MarketSide = (typeof MARKET_SIDE)[number];

/** Placement does NOT use `questions`; it uses `placement_items` (§5.5). */
export const QUESTION_KIND = ['daily', 'nemesis_bonus', 'duo_bonus'] as const;
export type QuestionKind = (typeof QUESTION_KIND)[number];

export const QUESTION_STATUS = [
  'draft',
  'scheduled',
  'open',
  'locked',
  'revealed',
  'voided',
] as const;
export type QuestionStatus = (typeof QUESTION_STATUS)[number];

export const PICK_RESULT = ['pending', 'win', 'loss', 'void'] as const;
export type PickResult = (typeof PICK_RESULT)[number];

export const PICK_SOURCE = ['web', 'share_card', 'spectator_page'] as const;
export type PickSource = (typeof PICK_SOURCE)[number];

export const PAIRING_STATUS = ['scheduled', 'active', 'completed', 'cancelled'] as const;
export type PairingStatus = (typeof PAIRING_STATUS)[number];

export const DUO_STATUS = ['active', 'disbanded'] as const;
export type DuoStatus = (typeof DUO_STATUS)[number];

export const DUO_MATCH_STATUS = ['scheduled', 'active', 'completed', 'cancelled'] as const;
export type DuoMatchStatus = (typeof DUO_MATCH_STATUS)[number];

export const QUEUE_STATUS = ['waiting', 'matched', 'cancelled'] as const;
export type QueueStatus = (typeof QUEUE_STATUS)[number];

export const POST_STATUS = ['visible', 'removed_by_mod', 'removed_by_author'] as const;
export type PostStatus = (typeof POST_STATUS)[number];

export const REPORT_STATUS = ['open', 'actioned', 'dismissed'] as const;
export type ReportStatus = (typeof REPORT_STATUS)[number];

export const WALLET_LINK_STATUS = ['active', 'unlinked'] as const;
export type WalletLinkStatus = (typeof WALLET_LINK_STATUS)[number];

export const REMATCH_STATUS = ['open', 'accepted', 'declined', 'expired'] as const;
export type RematchStatus = (typeof REMATCH_STATUS)[number];

/** Used by posts + reactions (§5.1). */
export const THREAD_CONTEXT = ['question', 'pairing', 'duo_match'] as const;
export type ThreadContext = (typeof THREAD_CONTEXT)[number];

export const REPORT_CONTEXT = ['post', 'pairing', 'duo', 'profile'] as const;
export type ReportContext = (typeof REPORT_CONTEXT)[number];

export const REPORT_REASON = ['abuse', 'spam', 'cheating', 'other'] as const;
export type ReportReason = (typeof REPORT_REASON)[number];

export const NOTIFICATION_STATUS = ['queued', 'sent', 'failed', 'cancelled'] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUS)[number];

export const USER_ROLE = ['user', 'admin'] as const;
export type UserRole = (typeof USER_ROLE)[number];

export const SEASON_KIND = ['nemesis', 'duo', 'house'] as const;
export type SeasonKind = (typeof SEASON_KIND)[number];

/** Notification channel (§5.6 `notifications.channel`). */
export const NOTIFICATION_CHANNEL = ['email', 'push'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNEL)[number];
