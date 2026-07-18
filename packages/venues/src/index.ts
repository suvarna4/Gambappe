/**
 * @receipts/venues — VenueAdapter interface + mock (design doc §4.1, §7.1, WS0-T6) plus the
 * real Kalshi/Polymarket adapters and venue HTTP client (WS1, §7.2–7.4). The shared
 * contract-test suite is exported from `@receipts/venues/contract-suite` (it imports vitest,
 * so it stays out of the runtime entrypoint).
 */
export * from './adapter.js';
export { MockVenueAdapter, type MockMarketInput } from './mock/index.js';
export { createVenueHttpClient, VenueHttpError } from './http-client.js';
export type {
  VenueHttpClient,
  VenueHttpClientOptions,
  VenueHttpRequestOptions,
} from './http-client.js';
export { KalshiAdapter, type KalshiAdapterOptions } from './kalshi/index.js';
export {
  KalshiWsTicker,
  type KalshiTickerQuote,
  type KalshiWsTickerOptions,
} from './kalshi/ws-ticker.js';
export { PolymarketAdapter, type PolymarketAdapterOptions } from './polymarket/index.js';
export { computeDivergence, type DivergenceResult, type VenuePriceReading } from './divergence.js';
