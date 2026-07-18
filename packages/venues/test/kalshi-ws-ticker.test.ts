/**
 * WS1-T6 AC (§7.3, P1.5): flag-gated — `subscribe()` is a no-op with the flag off. REST
 * (`venue:price-tick`, WS1-T4) never imports/depends on this ticker (grep-verifiable), so
 * killing the WS connection causes zero functional loss by construction, not just by test.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KalshiWsTicker, type KalshiTickerQuote } from '../src/kalshi/ws-ticker.js';

type Listener = (event: { data?: unknown }) => void;

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  readonly url: string;
  readonly sent: string[] = [];
  closed = false;
  private listeners = new Map<string, Listener[]>();

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, cb: Listener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(cb);
    this.listeners.set(type, list);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
  }

  dispatch(type: string, event: { data?: unknown } = {}): void {
    for (const cb of this.listeners.get(type) ?? []) cb(event);
  }
}

afterEach(() => {
  FakeWebSocket.instances = [];
});

describe('KalshiWsTicker — flag gating', () => {
  it('does nothing when the flag is disabled', () => {
    const ticker = new KalshiWsTicker({
      wsUrl: 'wss://fake.test/ws/v2',
      WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
      isEnabled: () => false,
    });
    ticker.subscribe(['KX-TICKER-1']);
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('does nothing when there are no tickers to subscribe to', () => {
    const ticker = new KalshiWsTicker({
      wsUrl: 'wss://fake.test/ws/v2',
      WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
      isEnabled: () => true,
    });
    ticker.subscribe([]);
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('degrades silently with no wsUrl and no KALSHI_API_BASE', () => {
    const original = process.env['KALSHI_API_BASE'];
    delete process.env['KALSHI_API_BASE'];
    const ticker = new KalshiWsTicker({
      WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
      isEnabled: () => true,
    });
    ticker.subscribe(['KX-TICKER-1']);
    expect(FakeWebSocket.instances).toHaveLength(0);
    if (original !== undefined) process.env['KALSHI_API_BASE'] = original;
  });
});

describe('KalshiWsTicker — subscribe/quote flow (flag on)', () => {
  it('opens a socket and sends a subscribe message for the given tickers', () => {
    const ticker = new KalshiWsTicker({
      wsUrl: 'wss://fake.test/ws/v2',
      WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
      isEnabled: () => true,
    });
    ticker.subscribe(['KX-TICKER-1', 'KX-TICKER-2']);
    expect(FakeWebSocket.instances).toHaveLength(1);
    const socket = FakeWebSocket.instances[0]!;

    socket.dispatch('open');
    expect(socket.sent).toHaveLength(1);
    const payload = JSON.parse(socket.sent[0]!) as {
      cmd: string;
      params: { channels: string[]; market_tickers: string[] };
    };
    expect(payload.cmd).toBe('subscribe');
    expect(payload.params.channels).toContain('ticker');
    expect(payload.params.market_tickers).toEqual(['KX-TICKER-1', 'KX-TICKER-2']);
  });

  it('parses a ticker message into a clamped yes-price quote', () => {
    const quotes: KalshiTickerQuote[] = [];
    const ticker = new KalshiWsTicker({
      wsUrl: 'wss://fake.test/ws/v2',
      WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
      isEnabled: () => true,
      onQuote: (q) => quotes.push(q),
    });
    ticker.subscribe(['KX-TICKER-1']);
    const socket = FakeWebSocket.instances[0]!;

    socket.dispatch('message', {
      data: JSON.stringify({ msg: { market_ticker: 'KX-TICKER-1', yes_bid: 60, yes_ask: 64 } }),
    });
    expect(quotes).toHaveLength(1);
    expect(quotes[0]!.venueMarketId).toBe('KX-TICKER-1');
    expect(quotes[0]!.yesPrice).toBeCloseTo(0.62, 5);
    expect(quotes[0]!.ts).toBeInstanceOf(Date);
  });

  it('ignores malformed/unexpected messages without throwing (never a failure source)', () => {
    const onError = vi.fn();
    const quotes: KalshiTickerQuote[] = [];
    const ticker = new KalshiWsTicker({
      wsUrl: 'wss://fake.test/ws/v2',
      WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
      isEnabled: () => true,
      onQuote: (q) => quotes.push(q),
      onError,
    });
    ticker.subscribe(['KX-TICKER-1']);
    const socket = FakeWebSocket.instances[0]!;

    expect(() => socket.dispatch('message', { data: 'not json' })).not.toThrow();
    expect(() => socket.dispatch('message', { data: JSON.stringify({ unrelated: true }) })).not.toThrow();
    expect(quotes).toHaveLength(0);
    expect(onError).toHaveBeenCalledTimes(1); // only the unparseable payload, not the well-formed-but-irrelevant one
  });

  it('close() closes the underlying socket', () => {
    const ticker = new KalshiWsTicker({
      wsUrl: 'wss://fake.test/ws/v2',
      WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
      isEnabled: () => true,
    });
    ticker.subscribe(['KX-TICKER-1']);
    const socket = FakeWebSocket.instances[0]!;
    expect(socket.closed).toBe(false);
    ticker.close();
    expect(socket.closed).toBe(true);
  });
});
