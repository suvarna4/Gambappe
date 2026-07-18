/**
 * Shared venue HTTP client (design doc §7.2): fetch-based mechanics used by every real
 * adapter — 5s timeout, 3 retries with jittered exponential backoff (250ms base) on
 * 429/5xx/network errors, and a per-venue in-process token-bucket rate limiter
 * (`VENUE_RATE_LIMIT_RPS`). This runs only inside the single worker process (§2.2), so an
 * in-process limiter is sufficient — no Redis-backed distributed limiting needed here.
 *
 * HTTP mechanics only: callers zod-validate the returned JSON. A malformed body, non-2xx
 * status, or network failure always throws `VenueHttpError` — never a partial/undefined
 * "success".
 */
import { VENUE_RATE_LIMIT_RPS } from '@receipts/core';

export class VenueHttpError extends Error {
  readonly status: number | undefined;
  override readonly cause: unknown;

  constructor(message: string, opts: { status?: number; cause?: unknown } = {}) {
    super(message);
    this.name = 'VenueHttpError';
    this.status = opts.status;
    this.cause = opts.cause;
  }
}

export interface VenueHttpRequestOptions {
  headers?: Record<string, string>;
  searchParams?: Record<string, string | number | undefined>;
}

export interface VenueHttpClient {
  get<T>(url: string, opts?: VenueHttpRequestOptions): Promise<T>;
}

export interface VenueHttpClientOptions {
  /** Requests/second cap (default `VENUE_RATE_LIMIT_RPS`, §7.2). */
  rps?: number;
  timeoutMs?: number;
  /** Retry attempts AFTER the first try (default 3, §7.2). */
  maxRetries?: number;
  /** Backoff base, ms (default 250, §7.2 "jittered exponential backoff (250ms base)"). */
  baseDelayMs?: number;
  fetchImpl?: typeof fetch;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Full jitter: uniform(0, base * 2^attempt) — avoids thundering-herd retries. */
function jitteredBackoff(attempt: number, baseDelayMs: number): number {
  const cap = baseDelayMs * 2 ** attempt;
  return Math.random() * cap;
}

/**
 * In-process token bucket. Refills continuously (not per-tick) so bursts up to `rps` tokens
 * are allowed but sustained throughput never exceeds `rps` req/s.
 */
class TokenBucket {
  private tokens: number;
  private lastRefillMs: number;

  constructor(private readonly rps: number) {
    if (rps <= 0) throw new Error('TokenBucket: rps must be > 0');
    // Start with a single token rather than a full `rps` burst — conservative default (§7.2):
    // a freshly created adapter's first calls are rate-limited from request one, not just once
    // steady state kicks in. Idle periods still refill up to `rps` capacity for later bursts.
    this.tokens = 1;
    this.lastRefillMs = Date.now();
  }

  private refill(): void {
    const nowMs = Date.now();
    const elapsedS = (nowMs - this.lastRefillMs) / 1000;
    if (elapsedS > 0) {
      this.tokens = Math.min(this.rps, this.tokens + elapsedS * this.rps);
      this.lastRefillMs = nowMs;
    }
  }

  async acquire(): Promise<void> {
    for (;;) {
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      const deficitS = (1 - this.tokens) / this.rps;
      await sleep(Math.max(1, Math.ceil(deficitS * 1000)));
    }
  }
}

function buildUrl(url: string, params?: Record<string, string | number | undefined>): string {
  if (!params) return url;
  const u = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) u.searchParams.set(key, String(value));
  }
  return u.toString();
}

/**
 * Origin+path only, query string stripped — this client is shared by every venue adapter,
 * including the wallet-import data-API client whose query params carry a raw EOA address
 * (`?user=0x...`). §16.2: never log a wallet address; a query string is never safe to include
 * in a thrown error's message (which routinely ends up in logs) regardless of caller.
 */
function redactedUrl(fullUrl: string): string {
  try {
    const u = new URL(fullUrl);
    return `${u.origin}${u.pathname}`;
  } catch {
    return fullUrl.split('?')[0] ?? fullUrl;
  }
}

export function createVenueHttpClient(options: VenueHttpClientOptions = {}): VenueHttpClient {
  const rps = options.rps ?? VENUE_RATE_LIMIT_RPS;
  const timeoutMs = options.timeoutMs ?? 5_000;
  const maxRetries = options.maxRetries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 250;
  const fetchImpl = options.fetchImpl ?? fetch;
  const bucket = new TokenBucket(rps);

  async function get<T>(url: string, opts: VenueHttpRequestOptions = {}): Promise<T> {
    const fullUrl = buildUrl(url, opts.searchParams);
    const safeUrl = redactedUrl(fullUrl);
    let lastError: VenueHttpError | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      await bucket.acquire();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      let res: Response;
      try {
        res = await fetchImpl(fullUrl, { headers: opts.headers, signal: controller.signal });
      } catch (err) {
        clearTimeout(timer);
        lastError = new VenueHttpError(`venue http: network error (${safeUrl})`, { cause: err });
        if (attempt < maxRetries) {
          await sleep(jitteredBackoff(attempt, baseDelayMs));
          continue;
        }
        throw lastError;
      }
      clearTimeout(timer);

      if (!res.ok) {
        const httpErr = new VenueHttpError(`venue http ${res.status} (${safeUrl})`, {
          status: res.status,
        });
        if (isRetryableStatus(res.status) && attempt < maxRetries) {
          lastError = httpErr;
          await sleep(jitteredBackoff(attempt, baseDelayMs));
          continue;
        }
        throw httpErr;
      }

      // Never return a partial/malformed success — a bad body is a hard failure, not retried
      // (retrying can't fix a parse error).
      try {
        return (await res.json()) as T;
      } catch (err) {
        throw new VenueHttpError(`venue http: invalid JSON response (${safeUrl})`, { cause: err });
      }
    }

    throw lastError ?? new VenueHttpError(`venue http: exhausted retries (${safeUrl})`);
  }

  return { get };
}
