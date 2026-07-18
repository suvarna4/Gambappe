/**
 * Postgres enums (design doc §5.1) — defined FROM the @receipts/core arrays so DB and
 * contract can never drift.
 */
import { pgEnum } from 'drizzle-orm/pg-core';
import {
  DUO_MATCH_STATUS,
  DUO_STATUS,
  MARKET_CATEGORY,
  MARKET_SIDE,
  MARKET_STATUS,
  NOTIFICATION_CHANNEL,
  NOTIFICATION_STATUS,
  PAIRING_STATUS,
  PICK_RESULT,
  PICK_SOURCE,
  POST_STATUS,
  PROFILE_KIND,
  PROFILE_STATUS,
  QUEUE_STATUS,
  QUESTION_KIND,
  QUESTION_STATUS,
  REMATCH_STATUS,
  REPORT_CONTEXT,
  REPORT_REASON,
  REPORT_STATUS,
  SEASON_KIND,
  THREAD_CONTEXT,
  USER_ROLE,
  VENUE,
  WALLET_LINK_STATUS,
} from '@receipts/core';

export const profileKindEnum = pgEnum('profile_kind', [...PROFILE_KIND]);
export const profileStatusEnum = pgEnum('profile_status', [...PROFILE_STATUS]);
export const venueEnum = pgEnum('venue', [...VENUE]);
export const marketCategoryEnum = pgEnum('market_category', [...MARKET_CATEGORY]);
export const marketStatusEnum = pgEnum('market_status', [...MARKET_STATUS]);
export const marketSideEnum = pgEnum('market_side', [...MARKET_SIDE]);
export const questionKindEnum = pgEnum('question_kind', [...QUESTION_KIND]);
export const questionStatusEnum = pgEnum('question_status', [...QUESTION_STATUS]);
export const pickResultEnum = pgEnum('pick_result', [...PICK_RESULT]);
export const pickSourceEnum = pgEnum('pick_source', [...PICK_SOURCE]);
export const pairingStatusEnum = pgEnum('pairing_status', [...PAIRING_STATUS]);
export const duoStatusEnum = pgEnum('duo_status', [...DUO_STATUS]);
export const duoMatchStatusEnum = pgEnum('duo_match_status', [...DUO_MATCH_STATUS]);
export const queueStatusEnum = pgEnum('queue_status', [...QUEUE_STATUS]);
export const postStatusEnum = pgEnum('post_status', [...POST_STATUS]);
export const reportStatusEnum = pgEnum('report_status', [...REPORT_STATUS]);
export const walletLinkStatusEnum = pgEnum('wallet_link_status', [...WALLET_LINK_STATUS]);
export const rematchStatusEnum = pgEnum('rematch_status', [...REMATCH_STATUS]);
export const threadContextEnum = pgEnum('thread_context', [...THREAD_CONTEXT]);
export const reportContextEnum = pgEnum('report_context', [...REPORT_CONTEXT]);
export const reportReasonEnum = pgEnum('report_reason', [...REPORT_REASON]);
export const notificationStatusEnum = pgEnum('notification_status', [...NOTIFICATION_STATUS]);
export const userRoleEnum = pgEnum('user_role', [...USER_ROLE]);
export const seasonKindEnum = pgEnum('season_kind', [...SEASON_KIND]);
export const notificationChannelEnum = pgEnum('notification_channel', [...NOTIFICATION_CHANNEL]);
