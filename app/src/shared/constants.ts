/**
 * Single source of truth for every magic number in the product.
 * Mirrors design-doc §2 exactly (MVP-relevant subset). Never inline these
 * values elsewhere — import CONSTANTS.
 */
export const CONSTANTS = {
  QUESTION_OPEN_TIME_ET: "09:00",
  QUESTION_LOCK_TIME_ET: "12:00",
  REVEAL_TARGET_TIME_ET: "21:00",

  LONGSHOT_THRESHOLD: 0.2,

  CLAIM_PROMPT_STREAK: 3,
  CLAIM_PROMPT_PICKS: 5,

  NEMESIS_MIN_PICKS: 3, // MVP demo-friendly override, §16.5

  PRICE_POLL_OPEN_WINDOW_SEC: 30,
  PRICE_POLL_REVEAL_WINDOW_SEC: 5,
  PRICE_MAX_STALENESS_SEC: 300,
  PRICE_STALENESS_WARN_SEC: 120,

  GHOST_MINT_LIMIT_PER_IP_DAY: 20,
  PICK_RATE_LIMIT_PER_MIN: 10,
  WRITE_RATE_LIMIT_DEFAULT_PER_MIN: 30,
  AUTH_RATE_LIMIT_PER_MIN: 5,
  EVENTS_RATE_LIMIT_PER_MIN: 60,

  SESSION_MAX_AGE_DAYS: 90,
  GHOST_COOKIE_MAX_AGE_DAYS: 400,

  NEMESIS_RATING_BAND: 0.15, // §16.5: band by trailing accuracy ±0.15
  NEMESIS_MATCH_QUESTIONS: 3, // §16.5: next 3 daily questions
} as const;

export type Category =
  | "sports"
  | "politics"
  | "econ"
  | "culture"
  | "science"
  | "other";

export const CATEGORIES: Category[] = [
  "sports",
  "politics",
  "econ",
  "culture",
  "science",
  "other",
];
