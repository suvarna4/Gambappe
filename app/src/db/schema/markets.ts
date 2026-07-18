import {
  pgTable,
  uuid,
  text,
  timestamp,
  numeric,
  jsonb,
  pgEnum,
  bigserial,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const venueEnum = pgEnum("venue", ["kalshi", "polymarket", "fake"]);
export const categoryEnum = pgEnum("category", [
  "sports",
  "politics",
  "econ",
  "culture",
  "science",
  "other",
]);
export const marketStatusEnum = pgEnum("market_status", [
  "active",
  "settled",
  "voided",
]);
export const outcomeEnum = pgEnum("outcome", ["yes", "no", "void"]);

// §4.2 markets — adopted venue markets (MVP: no market_catalog mirror;
// admin pastes a ticker and the server fetches it once, §16.5)
export const markets = pgTable(
  "markets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    venue: venueEnum("venue").notNull(),
    venueMarketId: text("venue_market_id").notNull(),
    title: text("title").notNull(),
    category: categoryEnum("category").notNull(),
    yesLabel: text("yes_label").notNull(),
    noLabel: text("no_label").notNull(),
    url: text("url").notNull(),
    closeTime: timestamp("close_time", { withTimezone: true }),
    status: marketStatusEnum("status").notNull().default("active"),
    outcome: outcomeEnum("outcome"),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    lastPriceYes: numeric("last_price_yes", { precision: 6, scale: 5 }),
    priceUpdatedAt: timestamp("price_updated_at", { withTimezone: true }),
    raw: jsonb("raw"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("markets_venue_market_unique").on(t.venue, t.venueMarketId),
    index("markets_status_idx").on(t.status),
    index("markets_category_idx").on(t.category),
  ]
);

// §4.2 market_prices — append-only price history
export const marketPrices = pgTable(
  "market_prices",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    marketId: uuid("market_id")
      .notNull()
      .references(() => markets.id),
    priceYes: numeric("price_yes", { precision: 6, scale: 5 }).notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("market_prices_market_observed_idx").on(t.marketId, t.observedAt)]
);
