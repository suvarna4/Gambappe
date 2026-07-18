/**
 * Tunable constants — the single source of truth (design doc Appendix D + §14.1).
 *
 * Every magic number in the product is defined HERE and only here (§0.1 rule 4).
 * Code must import these; never hardcode a value that appears in this file.
 */

// --- Daily schedule (DD-1: single global schedule in America/New_York) -----------------------

/** IANA zone anchoring all ET-scheduled instants (§4.3 — never hardcode UTC offsets). */
export const SCHEDULE_TZ = 'America/New_York';
/** Daily question opens (local ET, HH:mm). */
export const DAILY_OPEN_LOCAL = '09:00';
/** Daily question locks (local ET, HH:mm). */
export const DAILY_LOCK_LOCAL = '12:00';
/** Daily reveal target (local ET, HH:mm). */
export const DAILY_REVEAL_LOCAL = '20:00';

// --- Picks (§6.2) ----------------------------------------------------------------------------

/** Undo (hard delete) window after a pick, seconds (DD-2). */
export const UNDO_WINDOW_S = 60;
/** Redis price cache max age for stamping, seconds. */
export const PRICE_MAX_STALENESS_S = 60;
/** DB `markets.yes_price` fallback max age (non-volatile questions only), seconds. */
export const PRICE_FALLBACK_STALENESS_S = 300;
/** Max stamped-price age for `is_volatile` questions (no DB fallback), seconds. */
export const VOLATILE_PRICE_MAX_STALENESS_S = 60;

// --- Reveal & badges (§6.7) ------------------------------------------------------------------

/** "Called it" badge: win with implied entry probability of chosen side ≤ this. */
export const LONGSHOT_THRESHOLD = 0.2;
/** Hours past `reveal_at` before admin escalation. */
export const REVEAL_MAX_DELAY_H = 12;
/** Minutes between `reveal:fire` re-arms while unsettled. */
export const REVEAL_REARM_MIN = 30;

// --- Streaks (§6.6, DD-3) --------------------------------------------------------------------

/** Max banked streak freezes. */
export const STREAK_FREEZE_CAP = 2;
/** Freeze earn: answered at least this many of the prior FREEZE_EARN_WINDOW_DAYS dailies. */
export const FREEZE_EARN_MIN_DAYS = 5;
/** Freeze earn look-back window in days ("5 of 7", Appendix D). */
export const FREEZE_EARN_WINDOW_DAYS = 7;
/** Streak milestones that fire `streak_milestone` beats (§13.3). */
export const STREAK_MILESTONES = [3, 7, 14, 30] as const;

// --- Grading & corrections (§6.5) ------------------------------------------------------------

/** Hours during which an admin may regrade / post-reveal void. */
export const REGRADE_WINDOW_H = 48;

// --- Fingerprint (§8.1) ----------------------------------------------------------------------

/** Minimum crowd-at-lock size for a pick to count toward the contrarian metric. */
export const CROWD_MIN_N = 20;
/** Shrinkage constant: raw style axes are multiplied by n/(n + SHRINK_K). */
export const SHRINK_K = 10;
/** Placement/wallet prior blend weight (§8.1 prior blending). */
export const PRIOR_WEIGHT = 5;

// --- Style vector weights (§8.2) -------------------------------------------------------------

export const W_CHALK = 1.0;
export const W_CONTRA = 1.0;
export const W_TIMING = 0.5;
export const W_CAT = 0.75;

// --- Ratings (§8.3) --------------------------------------------------------------------------

/** Glicko-2 system constant τ. */
export const GLICKO_TAU = 0.5;
/**
 * Minimum lifetime graded picks for `ratings.accuracy_percentile` eligibility ("nightly, rank
 * of lifetime accuracy among profiles with ≥10 graded picks; display-only", §8.3). Not in the
 * doc's original Appendix D table — added by WS4-T7 since §0.1 rule 4 requires every magic
 * number to live here; see the matching Appendix D row added in this same PR.
 */
export const ACCURACY_PERCENTILE_MIN_PICKS = 10;

// --- Matchmaking (§8.4, §8.5) ----------------------------------------------------------------

/** Graded picks required for nemesis eligibility. */
export const NEMESIS_MIN_PICKS = 5;
/** Graded picks required for duo eligibility. */
export const DUO_MIN_PICKS = 10;
/** Nemesis rating band base (|Δr| ≤ max(base, 0.5·(RD_a+RD_b))). */
export const NEMESIS_BAND_BASE = 150;
/** Duo partner-matching rating band base. */
export const DUO_BAND_BASE = 150;
/** Duo band widening per 30s queue tick. */
export const DUO_BAND_WIDEN = 25;
/** Duo band cap. */
export const DUO_BAND_CAP = 400;
/** Minimum category overlap for a nemesis pairing. */
export const OVERLAP_FLOOR = 0.25;
/** Edge-score bonus for close timezones. */
export const TZ_BONUS = 0.05;
/** Max UTC-offset difference (hours) that earns TZ_BONUS. */
export const TZ_BONUS_MAX_OFFSET_H = 3;
/** Edge-score penalty per rating point of difference. */
export const RD_PENALTY = 0.0002;
/** Edge-score bonus for last week's leftover (matchmaking_priority) profiles. */
export const PRIORITY_BONUS = 0.1;
/** Bounded 2-opt improvement passes in the nemesis matcher. */
export const MATCHER_2OPT_PASSES = 3;

// --- Duo chemistry & ladder (§8.9, §8.10) ----------------------------------------------------

/** Graded slots required before synergy is displayed. */
export const SYNERGY_MIN_PICKS = 12;
export const LADDER_TIERS = 5;
/** Fraction of duos promoted at duo-season end (Appendix D: 20%). */
export const LADDER_PROMOTE_PCT = 0.2;
/** Fraction of duos relegated at duo-season end (Appendix D: 20%). */
export const LADDER_RELEGATE_PCT = 0.2;

// --- Leaderboards (§8.12) --------------------------------------------------------------------

/** Picks graded-and-revealed in the window required to appear on a weekly board. */
export const LEADERBOARD_MIN_PICKS = 3;

// --- Seasons (§5.4, §8.10) -------------------------------------------------------------------

export const NEMESIS_SEASON_WEEKS = 12;
export const DUO_SEASON_WEEKS = 4;

// --- Social (§5.6) ---------------------------------------------------------------------------

export const POST_MAX_CHARS = 500;
/** The complete allowed reaction emoji set. */
export const REACTION_SET = ['🔥', '💀', '🧾', '🫡'] as const;

// --- Handles & identity (§6.1) ---------------------------------------------------------------

export const HANDLE_CHANGE_COOLDOWN_DAYS = 30;
/** Ghost mints allowed per IP per day (§6.1.1; same value as RL_GHOST_MINT_IP_DAY). */
export const GHOST_MINT_PER_IP_PER_DAY = 10;

// --- Integrity (§14.2, §14.3) ----------------------------------------------------------------

/** bot_score at/above which a profile is excluded from leaderboards/matchmaking/crowd snapshots. */
export const BOT_EXCLUDE_THRESHOLD = 0.8;
/** Distinct qualified reporters within AUTOPAUSE_REPORT_WINDOW_D days triggering auto-pause. */
export const AUTOPAUSE_REPORT_N = 3;
/** Report window (days) for the auto-pause rule ("within 7 days", §14.3). */
export const AUTOPAUSE_REPORT_WINDOW_D = 7;
/** Minimum account age (days) for a reporter to be "qualified". */
export const REPORTER_MIN_ACCOUNT_AGE_D = 7;

// --- Analytics (§13.1) -----------------------------------------------------------------------

/** Max serialized bytes of `props` on an analytics event; oversized events are dropped. */
export const EVENT_PROPS_MAX_BYTES = 2048;
/** Reveal attendance window, hours (§16.3). */
export const REVEAL_ATTENDANCE_WINDOW_H = 2;

// --- Admin (§15.3) ---------------------------------------------------------------------------

/** Minutes after venue market close before force-settle is allowed. */
export const FORCE_SETTLE_MIN_AFTER_CLOSE_MIN = 30;

// --- Auth & wallet (§11.1, §12) --------------------------------------------------------------

/** SIWE nonce TTL, minutes. */
export const SIWE_NONCE_TTL_MIN = 10;
/** Magic-link token TTL, minutes. */
export const MAGIC_LINK_TTL_MIN = 15;
/** Days before an unlinked wallet address may be re-linked. */
export const WALLET_RELINK_COOLDOWN_D = 7;

/**
 * Wallet position-size buckets (§12.4). Bounds are used TRANSIENTLY at ingestion only; only
 * bucket counts are ever persisted, and buckets are never serialized to any client (INV-7).
 * `maxUsdExclusive: null` = unbounded (xl ≥ $10k).
 */
export const WALLET_SIZE_BUCKETS = [
  { bucket: 'xs', maxUsdExclusive: 10 },
  { bucket: 's', maxUsdExclusive: 100 },
  { bucket: 'm', maxUsdExclusive: 1_000 },
  { bucket: 'l', maxUsdExclusive: 10_000 },
  { bucket: 'xl', maxUsdExclusive: null },
] as const;

// --- Venues (§7.2) ---------------------------------------------------------------------------

/** Conservative per-venue token-bucket limit, requests/second. */
export const VENUE_RATE_LIMIT_RPS = 4;

// --- Notifications (§13.2, WS9-T1 contract-change) --------------------------------------------

/**
 * Local HH:mm window (profile.timezone, default SCHEDULE_TZ) during which non-reveal
 * notifications are deferred to QUIET_HOURS_END_LOCAL rather than sent immediately (§13.2:
 * "Quiet hours: non-reveal notifications deferred to 08:00 local ... if scheduled 22:00-08:00").
 * Not in the doc's original Appendix D table — added by WS9-T1 since §0.1 rule 4 requires
 * every magic number to live here; see the matching Appendix D row added in this same PR.
 */
export const QUIET_HOURS_START_LOCAL = '22:00';
export const QUIET_HOURS_END_LOCAL = '08:00';
/**
 * Hard cap: at most this many non-transactional ("marketing-ish") emails per profile per local
 * day (§13.2: "Hard cap: ≤ 1 marketing-ish email/day/user"). Transactional kinds
 * (reveal/nemesis/duo) are exempt — see `isTransactionalNotificationKind` in `notifications.ts`.
 */
export const MARKETING_EMAIL_DAILY_CAP = 1;

// --- Houses (P2 stretch, §8.11) --------------------------------------------------------------

export const HOUSE_MIN_PROFILES = 500;

// --- Rate limits (§14.1 table — that table is the source of truth for these values) ----------

/** Ghost mint, per IP per day. */
export const RL_GHOST_MINT_IP_DAY = 10;
/** Pick create, per profile per hour. */
export const RL_PICK_PROFILE_H = 30;
/** Pick create, per IP per hour. */
export const RL_PICK_IP_H = 120;
/** Undo, per profile per hour. */
export const RL_UNDO_PROFILE_H = 10;
/** Reactions, per profile per day. */
export const RL_REACT_PROFILE_D = 100;
/** Posts, per profile per day. */
export const RL_POST_PROFILE_D = 20;
/** Posts, per profile per minute. */
export const RL_POST_PROFILE_MIN = 5;
/** Reports, per profile per day. */
export const RL_REPORT_PROFILE_D = 10;
/** Claim attempts, per IP per hour. */
export const RL_CLAIM_IP_H = 10;
/** Auth email sends, per email+IP per hour. */
export const RL_AUTH_EMAIL_H = 5;
/** SIWE nonce/verify, per profile per hour. */
export const RL_SIWE_PROFILE_H = 10;
/** POST /events, per IP per hour. */
export const RL_EVENTS_IP_H = 120;
/** /api/og/* + /api/cards/* (cached hits excluded), per IP per minute. */
export const RL_IMAGES_IP_MIN = 120;
/** POST /internal/revalidate, global per minute. */
export const RL_REVALIDATE_MIN = 60;
/** Backstop for any /api/v1 GET, per IP per minute. */
export const RL_GET_IP_MIN = 600;

/**
 * Redis-down posture (§14.1): mutation endpoints fall back to strict in-process limits at this
 * fraction of the table values per instance (fail-closed — never unlimited).
 */
export const RL_FAIL_CLOSED_FRACTION = 0.25;

// --- API conventions (§9.1, §9.2) ------------------------------------------------------------

/** Cursor pagination hard cap on `limit` (§9.1). */
export const PAGINATION_MAX_LIMIT = 50;
/** Max paths accepted by POST /internal/revalidate (§9.2 hardening). */
export const REVALIDATE_MAX_PATHS = 20;
/**
 * Route-pattern allowlist for POST /internal/revalidate (§9.2): `/q/*`, `/p/*`, `/vs/*`,
 * `/duos/*`, `/`, `/q`.
 */
export const REVALIDATE_PATH_ALLOWLIST: readonly RegExp[] = [
  /^\/$/,
  /^\/q$/,
  /^\/q\/[a-z0-9-]+$/,
  /^\/p\/[a-z0-9-]+$/,
  /^\/vs\/[a-z0-9-]+$/,
  /^\/duos\/[a-z0-9-]+$/,
];

// --- WS8: OG images + spectator ISR (§10.1, §10.2, §10.5) ------------------------------------

/** Immutable content-addressed OG/card image cache lifetime, seconds (§10.5). */
export const OG_CACHE_S_MAXAGE_S = 86400;

/** Default public GET cache-control for /api/v1 resources (§9.1 convention), seconds. */
export const PUBLIC_GET_S_MAXAGE_S = 30;
export const PUBLIC_GET_SWR_S = 300;

/** ISR `revalidate` seconds per public route kind (§10.1 route table). */
export const ISR_REVALIDATE_QUESTION_S = 30;
export const ISR_REVALIDATE_ARCHIVE_S = 86400;
export const ISR_REVALIDATE_PROFILE_S = 60;
export const ISR_REVALIDATE_PAIRING_S = 30;
export const ISR_REVALIDATE_DUO_S = 60;

// --- Data lifecycle (§11.5 table; centralized here per §0.1 rule 4) --------------------------

/** Ghost profiles unseen this long are pruned/anonymized by `maintenance:prune`. */
export const RETENTION_GHOST_UNSEEN_MONTHS = 13;
/** Price snapshots kept this many days. */
export const RETENTION_PRICE_SNAPSHOTS_DAYS = 90;
/** Raw analytics events kept this many months (then aggregate-only). */
export const RETENTION_ANALYTICS_MONTHS = 13;
/** Audit log kept this many months. */
export const RETENTION_AUDIT_LOG_MONTHS = 24;
/** analytics ip_hash/ua_hash nulled after this many days (§5.6). */
export const RETENTION_IP_UA_HASH_DAYS = 7;

// --- Aggregate view (used by the constants snapshot test, WS0-T2 AC) -------------------------

export const CONFIG = {
  SCHEDULE_TZ,
  DAILY_OPEN_LOCAL,
  DAILY_LOCK_LOCAL,
  DAILY_REVEAL_LOCAL,
  UNDO_WINDOW_S,
  PRICE_MAX_STALENESS_S,
  PRICE_FALLBACK_STALENESS_S,
  VOLATILE_PRICE_MAX_STALENESS_S,
  LONGSHOT_THRESHOLD,
  REVEAL_MAX_DELAY_H,
  REVEAL_REARM_MIN,
  STREAK_FREEZE_CAP,
  FREEZE_EARN_MIN_DAYS,
  FREEZE_EARN_WINDOW_DAYS,
  STREAK_MILESTONES,
  REGRADE_WINDOW_H,
  CROWD_MIN_N,
  SHRINK_K,
  PRIOR_WEIGHT,
  W_CHALK,
  W_CONTRA,
  W_TIMING,
  W_CAT,
  GLICKO_TAU,
  ACCURACY_PERCENTILE_MIN_PICKS,
  NEMESIS_MIN_PICKS,
  DUO_MIN_PICKS,
  NEMESIS_BAND_BASE,
  DUO_BAND_BASE,
  DUO_BAND_WIDEN,
  DUO_BAND_CAP,
  OVERLAP_FLOOR,
  TZ_BONUS,
  TZ_BONUS_MAX_OFFSET_H,
  RD_PENALTY,
  PRIORITY_BONUS,
  MATCHER_2OPT_PASSES,
  SYNERGY_MIN_PICKS,
  LADDER_TIERS,
  LADDER_PROMOTE_PCT,
  LADDER_RELEGATE_PCT,
  LEADERBOARD_MIN_PICKS,
  NEMESIS_SEASON_WEEKS,
  DUO_SEASON_WEEKS,
  POST_MAX_CHARS,
  REACTION_SET,
  HANDLE_CHANGE_COOLDOWN_DAYS,
  GHOST_MINT_PER_IP_PER_DAY,
  BOT_EXCLUDE_THRESHOLD,
  AUTOPAUSE_REPORT_N,
  AUTOPAUSE_REPORT_WINDOW_D,
  REPORTER_MIN_ACCOUNT_AGE_D,
  EVENT_PROPS_MAX_BYTES,
  REVEAL_ATTENDANCE_WINDOW_H,
  FORCE_SETTLE_MIN_AFTER_CLOSE_MIN,
  SIWE_NONCE_TTL_MIN,
  MAGIC_LINK_TTL_MIN,
  WALLET_RELINK_COOLDOWN_D,
  WALLET_SIZE_BUCKETS,
  VENUE_RATE_LIMIT_RPS,
  QUIET_HOURS_START_LOCAL,
  QUIET_HOURS_END_LOCAL,
  MARKETING_EMAIL_DAILY_CAP,
  HOUSE_MIN_PROFILES,
  RL_GHOST_MINT_IP_DAY,
  RL_PICK_PROFILE_H,
  RL_PICK_IP_H,
  RL_UNDO_PROFILE_H,
  RL_REACT_PROFILE_D,
  RL_POST_PROFILE_D,
  RL_POST_PROFILE_MIN,
  RL_REPORT_PROFILE_D,
  RL_CLAIM_IP_H,
  RL_AUTH_EMAIL_H,
  RL_SIWE_PROFILE_H,
  RL_EVENTS_IP_H,
  RL_IMAGES_IP_MIN,
  RL_REVALIDATE_MIN,
  RL_GET_IP_MIN,
  RL_FAIL_CLOSED_FRACTION,
  PAGINATION_MAX_LIMIT,
  REVALIDATE_MAX_PATHS,
  OG_CACHE_S_MAXAGE_S,
  PUBLIC_GET_S_MAXAGE_S,
  PUBLIC_GET_SWR_S,
  ISR_REVALIDATE_QUESTION_S,
  ISR_REVALIDATE_ARCHIVE_S,
  ISR_REVALIDATE_PROFILE_S,
  ISR_REVALIDATE_PAIRING_S,
  ISR_REVALIDATE_DUO_S,
  RETENTION_GHOST_UNSEEN_MONTHS,
  RETENTION_PRICE_SNAPSHOTS_DAYS,
  RETENTION_ANALYTICS_MONTHS,
  RETENTION_AUDIT_LOG_MONTHS,
  RETENTION_IP_UA_HASH_DAYS,
} as const;
