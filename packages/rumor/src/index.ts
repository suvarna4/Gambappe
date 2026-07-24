/**
 * @receipts/rumor — Rumor Radar corpus + sentiment-odds pipeline
 * (docs/plans/ws27-rumor-radar.md). WS27-T1 scope: team vocabulary, the capture-once
 * snapshot format, the resolved-saga manifest, and Arctic Shift parsing. The extractor
 * (T2), aggregation + skill (T3), backtest harness (T4), and live pipeline (T6) build on
 * these exports.
 */
export * from './teams.js';
export * from './snapshot.js';
export * from './sagas.js';
export * from './arctic-shift.js';
export * from './lexicon.js';
export * from './extract.js';
export * from './skill.js';
export * from './aggregate.js';
export * from './backtest.js';
export * from './train.js';
export * from './polymarket.js';
export * from './reddit-oauth.js';
export * from './live.js';
