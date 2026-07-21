/**
 * The §14.1 rate-limit table, verbatim — this file is the single place that table gets
 * translated into (keyType, limit, window) tuples. Every mutation route's rate-limit call
 * should reference an entry here by name, never hardcode a constant directly.
 */
import {
  RL_AUTH_EMAIL_H,
  RL_CLAIM_IP_H,
  RL_EVENTS_IP_H,
  RL_GET_IP_MIN,
  RL_GHOST_MINT_IP_DAY,
  RL_IMAGES_IP_MIN,
  RL_PICK_IP_H,
  RL_PICK_PROFILE_H,
  RL_POST_PROFILE_D,
  RL_POST_PROFILE_MIN,
  RL_REACT_PROFILE_D,
  RL_REPORT_PROFILE_D,
  RL_REVALIDATE_MIN,
  RL_SHARE_TOKEN_IP_H,
  RL_SIWE_PROFILE_H,
  RL_UNDO_PROFILE_H,
} from '@receipts/core';

export type RateLimitKeyType = 'ip' | 'profile' | 'email_ip' | 'global';

export interface RateLimitRule {
  keyType: RateLimitKeyType;
  limit: number;
  windowSeconds: number;
}

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;

/** §14.1 table. */
export const RATE_LIMIT_RULES = {
  ghost_mint: { keyType: 'ip', limit: RL_GHOST_MINT_IP_DAY, windowSeconds: DAY },
  pick_create_profile: { keyType: 'profile', limit: RL_PICK_PROFILE_H, windowSeconds: HOUR },
  pick_create_ip: { keyType: 'ip', limit: RL_PICK_IP_H, windowSeconds: HOUR },
  undo: { keyType: 'profile', limit: RL_UNDO_PROFILE_H, windowSeconds: HOUR },
  reactions: { keyType: 'profile', limit: RL_REACT_PROFILE_D, windowSeconds: DAY },
  posts_daily: { keyType: 'profile', limit: RL_POST_PROFILE_D, windowSeconds: DAY },
  posts_minute: { keyType: 'profile', limit: RL_POST_PROFILE_MIN, windowSeconds: MINUTE },
  reports: { keyType: 'profile', limit: RL_REPORT_PROFILE_D, windowSeconds: DAY },
  claim_attempts: { keyType: 'ip', limit: RL_CLAIM_IP_H, windowSeconds: HOUR },
  auth_email_sends: { keyType: 'email_ip', limit: RL_AUTH_EMAIL_H, windowSeconds: HOUR },
  siwe: { keyType: 'profile', limit: RL_SIWE_PROFILE_H, windowSeconds: HOUR },
  events: { keyType: 'ip', limit: RL_EVENTS_IP_H, windowSeconds: HOUR },
  images: { keyType: 'ip', limit: RL_IMAGES_IP_MIN, windowSeconds: MINUTE },
  share_token: { keyType: 'ip', limit: RL_SHARE_TOKEN_IP_H, windowSeconds: HOUR },
  internal_revalidate: { keyType: 'global', limit: RL_REVALIDATE_MIN, windowSeconds: MINUTE },
  api_v1_get_backstop: { keyType: 'ip', limit: RL_GET_IP_MIN, windowSeconds: MINUTE },
  // journeys plan (WS18-T2): topic follow/unfollow toggle, profile-keyed (ghost incl.). Its own
  // bucket so a follow spree can't drain another action's quota. Literal (not a §14.1 core
  // constant) because the journeys plan didn't pin a number and WS18-T2 owns no core file.
  topic_follow: { keyType: 'profile', limit: 60, windowSeconds: HOUR },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitAction = keyof typeof RATE_LIMIT_RULES;
