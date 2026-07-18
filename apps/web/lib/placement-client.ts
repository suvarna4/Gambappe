/**
 * Client-side helpers for `/placement` (design doc §8.7, §9.2, WS7-T10). Two kinds of code
 * live here, same split as `apps/web/lib/placement-service.ts` (the server side of this same
 * flow): pure/presentational helpers (unit-testable, no network) and thin fetch wrappers over
 * the already-shipped WS4-T8 endpoints `GET /placement` / `POST /placement/answers`.
 *
 * Response shapes are hand-typed to mirror `core/schemas/placement.ts`
 * (`getPlacementResponseSchema` / `placementAnswerResponseSchema`) rather than importing those
 * zod schemas as VALUES here. §9.1 says "the frontend imports these; that is the web↔API
 * contract", and `import type` from `@receipts/core` for the enum types below does exactly
 * that (type-only imports are erased at compile time, so they're always safe). But importing
 * a schema as a *value* (to call `.parse()`) pulls in `@receipts/core`'s whole barrel at
 * runtime — which transitively imports `node:crypto` via `core/notifications.ts` (HMAC
 * unsubscribe-token signing) — and that breaks the client webpack bundle ("node:crypto ...
 * Unhandled scheme"), confirmed by actually running `pnpm build` here. `@receipts/core` has no
 * client-safe subpath export (e.g. `@receipts/core/schemas`) to import just the isomorphic
 * zod schemas without it, and adding one is a contract-change to someone else's package this
 * task's brief says to avoid absent a genuine need — so response shapes are duplicated as
 * plain TS interfaces instead, same pattern already used by
 * `apps/web/app/admin/curate/CurationClient.tsx` (hand-rolled response interfaces, no zod).
 */
import type { MarketCategory, MarketSide } from '@receipts/core';

export interface PlacementItem {
  id: string;
  title: string;
  category: MarketCategory;
  yes_label: string;
  no_label: string;
}

export interface PlacementAnswerResult {
  item_id: string;
  side: MarketSide;
  outcome: MarketSide;
  correct: boolean;
  historical_yes_price: number;
  historical_crowd_yes_pct: number;
  resolved_on: string;
}

/** Mirrors `@receipts/core`'s `ApiError` shape client-side (§9.1 error envelope). */
export class PlacementApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'PlacementApiError';
    this.code = code;
    this.status = status;
  }
}

interface ErrorEnvelope {
  error: { code: string; message: string; details?: unknown };
}

interface SuccessEnvelope<T> {
  data: T;
}

function isErrorEnvelope(json: unknown): json is ErrorEnvelope {
  if (typeof json !== 'object' || json === null || !('error' in json)) return false;
  const err = (json as { error: unknown }).error;
  return (
    typeof err === 'object' &&
    err !== null &&
    typeof (err as { code?: unknown }).code === 'string' &&
    typeof (err as { message?: unknown }).message === 'string'
  );
}

/** Parses the §9.1 envelope, throwing `PlacementApiError` for a non-2xx response. */
async function parseEnvelope<T>(response: Response): Promise<T> {
  const json: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    if (isErrorEnvelope(json)) {
      throw new PlacementApiError(json.error.code, json.error.message, response.status);
    }
    throw new PlacementApiError(
      'INTERNAL',
      `request failed with status ${response.status}`,
      response.status,
    );
  }

  if (typeof json !== 'object' || json === null || !('data' in json)) {
    throw new PlacementApiError('INTERNAL', 'malformed success response', response.status);
  }
  return (json as SuccessEnvelope<T>).data;
}

/** `GET /api/v1/placement` (§9.2): 5 items, no outcomes. Throws `PlacementApiError('UNAUTHENTICATED', …)` for a caller with no ghost/claimed identity yet (§6.1.1 — this GET never lazily mints one). */
export async function fetchPlacementItems(): Promise<PlacementItem[]> {
  const response = await fetch('/api/v1/placement', {
    method: 'GET',
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
  });
  const data = await parseEnvelope<{ items: PlacementItem[] }>(response);
  return data.items;
}

/** `POST /api/v1/placement/answers` (§9.2): the per-item mini reveal-loop result. */
export async function submitPlacementAnswer(
  itemId: string,
  side: MarketSide,
): Promise<PlacementAnswerResult> {
  const response = await fetch('/api/v1/placement/answers', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ item_id: itemId, side }),
  });
  return parseEnvelope<PlacementAnswerResult>(response);
}

// --- Pure helpers (unit-testable, no network/DOM) ----------------------------------------------

/** The label for whichever side (`item.yes_label` / `item.no_label`) — same convention as the
 * profile page's pick-log `PriceTag` usage. */
export function outcomeLabel(
  item: Pick<PlacementItem, 'yes_label' | 'no_label'>,
  side: MarketSide,
): string {
  return side === 'yes' ? item.yes_label : item.no_label;
}

/** `CrowdBar` takes yes/no counts, not a percentage; a 0–100 pct scales directly onto a
 * 100-count split without changing the rendered ratio (`crowdSplit` in `@receipts/ui` divides
 * by the total). Clamped defensively — `historical_crowd_yes_pct` is DB-sourced, not user input. */
export function crowdCountsFromPct(pct: number): { yesCount: number; noCount: number } {
  const clamped = Math.min(100, Math.max(0, pct));
  return { yesCount: clamped, noCount: 100 - clamped };
}

export function categoryLabel(category: MarketCategory): string {
  return category.charAt(0).toUpperCase() + category.slice(1);
}

export interface PlacementTally {
  correct: number;
  total: number;
}

export function tallyResults(results: readonly PlacementAnswerResult[]): PlacementTally {
  return { correct: results.filter((r) => r.correct).length, total: results.length };
}

// --- Analytics (§13.1) --------------------------------------------------------------------------

/**
 * Fire-and-forget client event via `POST /api/v1/events` (auth `none`, always 202, unknown
 * events dropped — §13.1/§9.2). `placement_started`/`placement_completed` are pre-existing
 * canonical event names in `core/types/analytics.ts` with no other producer yet; this is that
 * producer. Never blocks or throws into the caller — analytics must not break the flow.
 */
export function trackPlacementEvent(
  event: 'placement_started' | 'placement_completed',
  props?: Record<string, unknown>,
): void {
  try {
    fetch('/api/v1/events', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event, props: props ?? {} }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // best-effort only
  }
}
