/**
 * WS0-T2 AC: constants unit-snapshot test. Pins every Appendix D constant (and the §14.1
 * RL_* table) to the spec'd default — a change here is a `contract-change` PR by definition.
 */
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config.js';

describe('Appendix D constants', () => {
  it('matches the pinned defaults exactly', () => {
    expect(CONFIG).toMatchInlineSnapshot(`
      {
        "AUTOPAUSE_REPORT_N": 3,
        "AUTOPAUSE_REPORT_WINDOW_D": 7,
        "BOT_EXCLUDE_THRESHOLD": 0.8,
        "CROWD_MIN_N": 20,
        "DAILY_LOCK_LOCAL": "12:00",
        "DAILY_OPEN_LOCAL": "09:00",
        "DAILY_REVEAL_LOCAL": "20:00",
        "DUO_BAND_BASE": 150,
        "DUO_BAND_CAP": 400,
        "DUO_BAND_WIDEN": 25,
        "DUO_MIN_PICKS": 10,
        "DUO_SEASON_WEEKS": 4,
        "EVENT_PROPS_MAX_BYTES": 2048,
        "FORCE_SETTLE_MIN_AFTER_CLOSE_MIN": 30,
        "FREEZE_EARN_MIN_DAYS": 5,
        "FREEZE_EARN_WINDOW_DAYS": 7,
        "GHOST_MINT_PER_IP_PER_DAY": 10,
        "GLICKO_TAU": 0.5,
        "HANDLE_CHANGE_COOLDOWN_DAYS": 30,
        "HOUSE_MIN_PROFILES": 500,
        "LADDER_PROMOTE_PCT": 0.2,
        "LADDER_RELEGATE_PCT": 0.2,
        "LADDER_TIERS": 5,
        "LEADERBOARD_MIN_PICKS": 3,
        "LONGSHOT_THRESHOLD": 0.2,
        "MAGIC_LINK_TTL_MIN": 15,
        "MATCHER_2OPT_PASSES": 3,
        "NEMESIS_BAND_BASE": 150,
        "NEMESIS_MIN_PICKS": 5,
        "NEMESIS_SEASON_WEEKS": 12,
        "OVERLAP_FLOOR": 0.25,
        "PAGINATION_MAX_LIMIT": 50,
        "POST_MAX_CHARS": 500,
        "PRICE_FALLBACK_STALENESS_S": 300,
        "PRICE_MAX_STALENESS_S": 60,
        "PRIORITY_BONUS": 0.1,
        "PRIOR_WEIGHT": 5,
        "RD_PENALTY": 0.0002,
        "REACTION_SET": [
          "🔥",
          "💀",
          "🧾",
          "🫡",
        ],
        "REGRADE_WINDOW_H": 48,
        "REPORTER_MIN_ACCOUNT_AGE_D": 7,
        "RETENTION_ANALYTICS_MONTHS": 13,
        "RETENTION_AUDIT_LOG_MONTHS": 24,
        "RETENTION_GHOST_UNSEEN_MONTHS": 13,
        "RETENTION_IP_UA_HASH_DAYS": 7,
        "RETENTION_PRICE_SNAPSHOTS_DAYS": 90,
        "REVALIDATE_MAX_PATHS": 20,
        "REVEAL_ATTENDANCE_WINDOW_H": 2,
        "REVEAL_MAX_DELAY_H": 12,
        "REVEAL_REARM_MIN": 30,
        "RL_AUTH_EMAIL_H": 5,
        "RL_CLAIM_IP_H": 10,
        "RL_EVENTS_IP_H": 120,
        "RL_FAIL_CLOSED_FRACTION": 0.25,
        "RL_GET_IP_MIN": 600,
        "RL_GHOST_MINT_IP_DAY": 10,
        "RL_IMAGES_IP_MIN": 120,
        "RL_PICK_IP_H": 120,
        "RL_PICK_PROFILE_H": 30,
        "RL_POST_PROFILE_D": 20,
        "RL_POST_PROFILE_MIN": 5,
        "RL_REACT_PROFILE_D": 100,
        "RL_REPORT_PROFILE_D": 10,
        "RL_REVALIDATE_MIN": 60,
        "RL_SIWE_PROFILE_H": 10,
        "RL_UNDO_PROFILE_H": 10,
        "SCHEDULE_TZ": "America/New_York",
        "SHRINK_K": 10,
        "SIWE_NONCE_TTL_MIN": 10,
        "STREAK_FREEZE_CAP": 2,
        "STREAK_MILESTONES": [
          3,
          7,
          14,
          30,
        ],
        "SYNERGY_MIN_PICKS": 12,
        "TZ_BONUS": 0.05,
        "TZ_BONUS_MAX_OFFSET_H": 3,
        "UNDO_WINDOW_S": 60,
        "VENUE_RATE_LIMIT_RPS": 4,
        "VOLATILE_PRICE_MAX_STALENESS_S": 60,
        "WALLET_RELINK_COOLDOWN_D": 7,
        "WALLET_SIZE_BUCKETS": [
          {
            "bucket": "xs",
            "maxUsdExclusive": 10,
          },
          {
            "bucket": "s",
            "maxUsdExclusive": 100,
          },
          {
            "bucket": "m",
            "maxUsdExclusive": 1000,
          },
          {
            "bucket": "l",
            "maxUsdExclusive": 10000,
          },
          {
            "bucket": "xl",
            "maxUsdExclusive": null,
          },
        ],
        "W_CAT": 0.75,
        "W_CHALK": 1,
        "W_CONTRA": 1,
        "W_TIMING": 0.5,
      }
    `);
  });

  it('ghost mint config and the RL table agree (§6.1.1 / §14.1)', () => {
    expect(CONFIG.GHOST_MINT_PER_IP_PER_DAY).toBe(CONFIG.RL_GHOST_MINT_IP_DAY);
  });
});
