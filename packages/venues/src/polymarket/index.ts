export { PolymarketAdapter, type PolymarketAdapterOptions } from './adapter.js';
export { mapPolymarketCategory } from './category-map.js';
export {
  clampPrice,
  isBinaryPolymarketMarket,
  normalizeGammaMarket,
  polymarketGammaYesPrice,
  polymarketOutcomePrices,
  polymarketResolution,
  polymarketYesTokenId,
} from './normalize.js';
export {
  polymarketClobMidpointSchema,
  polymarketGammaMarketSchema,
  polymarketGammaMarketsResponseSchema,
  type PolymarketClobMidpoint,
  type PolymarketGammaMarket,
} from './schemas.js';
export {
  PolymarketDataApiClient,
  polymarketActivitySchema,
  polymarketPositionSchema,
  type PolymarketActivity,
  type PolymarketDataApiOptions,
  type PolymarketPosition,
} from './data-api.js';
export {
  computeCreate2ProxyAddress,
  resolvePolymarketProxy,
  saltFromOwner,
  POLYMARKET_PROXY_FACTORY_ADDRESS,
  POLYMARKET_PROXY_INIT_CODE_HASH,
  type ProxyResolution,
} from './proxy.js';
