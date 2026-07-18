import type { Category } from "@/shared/constants";

// §5.1 VenueAdapter interface — implemented by kalshi/ and fake/ only.
// Only server code behind cron/admin may import this (INV-5); page
// components must never import from src/venues.
export interface VenueAdapter {
  readonly venue: "kalshi" | "polymarket" | "fake";
  getMarket(venueMarketId: string): Promise<VenueMarket | null>;
  getPrice(
    venueMarketId: string
  ): Promise<{ priceYes: number; observedAt: Date } | null>;
  getResolution(
    venueMarketId: string
  ): Promise<{ outcome: "yes" | "no" | "void"; settledAt: Date } | null>;
}

export interface VenueMarket {
  venueMarketId: string;
  title: string;
  category: Category | null;
  yesLabel: string;
  noLabel: string;
  closeTime: Date | null;
  priceYes: number | null;
  url: string;
}

export function mapCategory(raw: string | null | undefined): Category {
  const s = (raw ?? "").toLowerCase();
  if (s.includes("sport") || s.includes("nfl") || s.includes("nba") || s.includes("soccer") || s.includes("world cup"))
    return "sports";
  if (s.includes("polit") || s.includes("election")) return "politics";
  if (s.includes("econ") || s.includes("fed") || s.includes("inflation") || s.includes("market"))
    return "econ";
  if (s.includes("culture") || s.includes("movie") || s.includes("music") || s.includes("award"))
    return "culture";
  if (s.includes("science") || s.includes("space") || s.includes("weather")) return "science";
  return "other";
}

/** 3 tries, exponential backoff 1s/2s/4s, 10s timeout (§5.1). Never throws raw. */
export async function fetchWithRetry(
  url: string,
  init?: RequestInit
): Promise<Response | null> {
  const delays = [0, 1000, 2000, 4000];
  for (let attempt = 0; attempt < delays.length; attempt++) {
    if (delays[attempt] > 0) await new Promise((r) => setTimeout(r, delays[attempt]));
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      const res = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timeout);
      if (res.ok) return res;
      if (attempt === delays.length - 1) {
        console.error(`fetchWithRetry: ${url} failed with status ${res.status}`);
        return null;
      }
    } catch (err) {
      if (attempt === delays.length - 1) {
        console.error(`fetchWithRetry: ${url} failed`, err);
        return null;
      }
    }
  }
  return null;
}
