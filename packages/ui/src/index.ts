/**
 * @receipts/ui — design-system components (design doc §10.4: TicketCard, Stamp, PriceTag,
 * CrowdBar, CountdownTicker, StreakFlame, Barcode). Components are pure/presentational
 * (props in, DOM out) so non-React consumers (e.g. a future satori/OG template) can share
 * the same tokens and formatting helpers.
 */
export * from './tokens.js';
export * from './format.js';
export * from './reduced-motion.js';
export * from './components/TicketCard.js';
export * from './components/Stamp.js';
export * from './components/PriceTag.js';
export * from './components/CrowdBar.js';
export * from './components/CountdownTicker.js';
export * from './components/StreakFlame.js';
export * from './components/Barcode.js';
