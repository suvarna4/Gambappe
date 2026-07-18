/**
 * @receipts/venues — VenueAdapter interface + mock (design doc §4.1, §7.1, WS0-T6).
 * The shared contract-test suite is exported from `@receipts/venues/contract-suite`
 * (it imports vitest, so it stays out of the runtime entrypoint). Real kalshi/ and
 * polymarket/ adapters are WS1 scope.
 */
export * from './adapter.js';
export { MockVenueAdapter, type MockMarketInput } from './mock/index.js';
