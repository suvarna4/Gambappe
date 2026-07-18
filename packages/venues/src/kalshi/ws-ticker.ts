/**
 * Kalshi WS ticker (§7.3, P1.5, flag-gated `kalshi_ws_ticker`): a live price flourish for
 * reveal windows. Purely additive — REST (`venue:price-tick`, WS1-T4) remains the sole
 * source of record for stamped prices/grading; killing this connection causes zero
 * functional loss (WS1-T6 AC). Uses the platform global `WebSocket` (stable in Node 22+)
 * rather than adding a `ws` package dependency.
 *
 * SPEC-GAP(WS1-T6): the exact Kalshi WS subscribe-message/ticker-payload shape is a
 * best-effort reconstruction — no live verification was possible in this sandbox (see
 * fixtures/venue-notes.md). Any malformed/unexpected message is ignored, never thrown —
 * this ticker can only ever be a flourish, never a failure source.
 */
import { isFlagEnabled } from '@receipts/core';
import { centsToProb } from './normalize.js';

export interface KalshiTickerQuote {
  venueMarketId: string;
  yesPrice: number;
  ts: Date;
}

export interface KalshiWsTickerOptions {
  /** Defaults to a `wss://` transform of env `KALSHI_API_BASE`. */
  wsUrl?: string;
  onQuote?: (quote: KalshiTickerQuote) => void;
  onError?: (err: unknown) => void;
  /** Injectable for tests; defaults to the global `WebSocket` constructor. */
  WebSocketImpl?: typeof WebSocket;
  /** Injectable for tests; defaults to `isFlagEnabled('kalshi_ws_ticker')`. */
  isEnabled?: () => boolean;
}

function defaultWsUrl(): string | undefined {
  const base = process.env['KALSHI_API_BASE'];
  if (!base) return undefined;
  return base.replace(/^http/, 'ws').replace(/\/$/, '') + '/ws/v2';
}

interface KalshiTickerMessage {
  msg?: {
    market_ticker?: unknown;
    yes_bid?: unknown;
    yes_ask?: unknown;
  };
}

function parseTickerMessage(raw: unknown): KalshiTickerQuote | undefined {
  const data = typeof raw === 'string' ? raw : String(raw);
  const parsed = JSON.parse(data) as KalshiTickerMessage;
  const ticker = parsed.msg?.market_ticker;
  const yesBid = parsed.msg?.yes_bid;
  const yesAsk = parsed.msg?.yes_ask;
  if (typeof ticker !== 'string' || typeof yesBid !== 'number' || typeof yesAsk !== 'number') {
    return undefined;
  }
  return { venueMarketId: ticker, yesPrice: centsToProb((yesBid + yesAsk) / 2), ts: new Date() };
}

/**
 * Flag-gated, best-effort live ticker. `subscribe()` is a no-op when the flag is off or
 * `KALSHI_API_BASE` is unset — always safe to call unconditionally from reveal-window UI
 * wiring without a separate feature check.
 */
export class KalshiWsTicker {
  private socket: WebSocket | undefined;

  constructor(private readonly options: KalshiWsTickerOptions = {}) {}

  subscribe(marketTickers: readonly string[]): void {
    const enabled = this.options.isEnabled ?? (() => isFlagEnabled('kalshi_ws_ticker'));
    if (!enabled() || marketTickers.length === 0) return;

    const wsUrl = this.options.wsUrl ?? defaultWsUrl();
    if (!wsUrl) return; // KALSHI_API_BASE unset — degrade silently, REST is unaffected

    const Impl = this.options.WebSocketImpl ?? globalThis.WebSocket;
    try {
      const socket = new Impl(wsUrl);
      this.socket = socket;
      socket.addEventListener('open', () => {
        socket.send(
          JSON.stringify({
            id: 1,
            cmd: 'subscribe',
            params: { channels: ['ticker'], market_tickers: [...marketTickers] },
          }),
        );
      });
      socket.addEventListener('message', (event: MessageEvent) => {
        try {
          const quote = parseTickerMessage(event.data);
          if (quote) this.options.onQuote?.(quote);
        } catch (err) {
          this.options.onError?.(err);
        }
      });
      socket.addEventListener('error', (event) => this.options.onError?.(event));
    } catch (err) {
      this.options.onError?.(err);
    }
  }

  close(): void {
    this.socket?.close();
    this.socket = undefined;
  }
}
