/**
 * @receipts/engine — pure functions over plain data (design doc §8). No DB, no clock reads
 * (time is a parameter), all constants from @receipts/core config.
 *
 * WS4 scope implemented here: fingerprint metrics (§8.1), style distance/complementarity (§8.2),
 * Glicko-2 (§8.3), nemesis matchmaking (§8.4), duo matchmaking (§8.5), scoring + chemistry
 * (§8.8–8.9), and narration (§13.3). Job wiring (§7.6) and placement seeding (§8.7) are WS4-T7/T8
 * — out of scope here.
 */
export * from './fingerprint.js';
export * from './glicko2.js';
export * from './style.js';
export * from './nemesis-matcher.js';
export * from './duo-matcher.js';
export * from './scoring.js';
export * from './narration.js';
export * from './wallet-bucketing.js';
