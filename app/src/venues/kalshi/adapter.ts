import type { VenueAdapter, VenueMarket } from "../types";
import { mapCategory, fetchWithRetry } from "../types";

interface KalshiMarketPayload {
  ticker: string;
  title: string;
  subtitle?: string;
  category?: string;
  yes_sub_title?: string;
  no_sub_title?: string;
  close_time?: string;
  status: string; // 'unopened' | 'open' | 'closed' | 'settled'
  yes_bid?: number; // cents, 0-100
  yes_ask?: number;
  result?: string; // '' | 'yes' | 'no' | 'void'
}

function baseUrl(): string {
  return process.env.KALSHI_BASE_URL ?? "https://api.elections.kalshi.com/trade-api/v2";
}

function marketUrl(ticker: string): string {
  const refParam = process.env.KALSHI_REF_PARAM;
  const slug = ticker.toLowerCase();
  const q = refParam ? `?ref=${encodeURIComponent(refParam)}` : "";
  return `https://kalshi.com/markets/${slug}${q}`;
}

async function fetchMarketPayload(ticker: string): Promise<KalshiMarketPayload | null> {
  const res = await fetchWithRetry(`${baseUrl()}/markets/${encodeURIComponent(ticker)}`);
  if (!res) return null;
  const json = (await res.json()) as { market?: KalshiMarketPayload };
  return json.market ?? null;
}

function toVenueMarket(m: KalshiMarketPayload): VenueMarket {
  const priceYes =
    typeof m.yes_bid === "number" && typeof m.yes_ask === "number"
      ? (m.yes_bid + m.yes_ask) / 2 / 100
      : null;
  return {
    venueMarketId: m.ticker,
    title: m.title,
    category: mapCategory(m.category ?? m.title),
    yesLabel: m.yes_sub_title || "Yes",
    noLabel: m.no_sub_title || "No",
    closeTime: m.close_time ? new Date(m.close_time) : null,
    priceYes,
    url: marketUrl(m.ticker),
  };
}

export const kalshiAdapter: VenueAdapter = {
  venue: "kalshi",

  async getMarket(venueMarketId) {
    const m = await fetchMarketPayload(venueMarketId);
    return m ? toVenueMarket(m) : null;
  },

  async getPrice(venueMarketId) {
    const m = await fetchMarketPayload(venueMarketId);
    if (!m) return null;
    if (typeof m.yes_bid !== "number" || typeof m.yes_ask !== "number") return null;
    return {
      priceYes: (m.yes_bid + m.yes_ask) / 2 / 100,
      observedAt: new Date(),
    };
  },

  async getResolution(venueMarketId) {
    const m = await fetchMarketPayload(venueMarketId);
    if (!m) return null;
    if (m.status !== "settled" && m.status !== "finalized") return null;
    if (!m.result) return null;
    const outcome =
      m.result === "yes" ? "yes" : m.result === "no" ? "no" : "void";
    return { outcome, settledAt: new Date() };
  },
};
