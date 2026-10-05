import { Inject, Injectable } from '@nestjs/common';
import { MARKET_DATA_CONFIG, MarketDataConfig } from './market-data.config';
import { AlpacaAdapter, parseEventTime } from './adapters/alpaca.adapter';
import { MarketTick } from './dto/market-tick.dto';
import { MOCK_ALPACA_CREDENTIALS } from './alpaca.protocol';

export function marketIdentity(t: MarketTick): string {
  return JSON.stringify([
    t.provider,
    t.feed,
    t.symbol,
    t.exchange,
    new Date(t.eventTimeMs).toISOString().slice(0, 10),
    t.eventId,
  ]);
}
export function orderMarketTicks(ticks: MarketTick[]): MarketTick[] {
  return ticks.sort((a, b) => {
    const at = parseEventTime(a.eventTime)!.ns;
    const bt = parseEventTime(b.eventTime)!.ns;
    return at < bt ? -1 : at > bt ? 1 : Number(a.eventId) - Number(b.eventId);
  });
}

@Injectable()
export class MarketHistoryClient {
  constructor(
    @Inject(MARKET_DATA_CONFIG) private readonly config: MarketDataConfig,
    private readonly adapter: AlpacaAdapter,
  ) {}

  async fetch(
    startMs: number,
    endMs: number,
    signal: AbortSignal,
  ): Promise<MarketTick[]> {
    if (this.config.feed === 'test')
      throw new Error('history_test_feed_unavailable');
    if (endMs < startMs || endMs - startMs > this.config.recoveryMaxGapMs)
      throw new Error('history_gap_limit');
    const endpoint =
      this.config.feed === 'mock'
        ? new URL(
            '/v2/stocks/trades',
            this.config.wsUrl.replace(/^ws:/, 'http:'),
          )
        : new URL('https://data.alpaca.markets/v2/stocks/trades');
    const credentials =
      this.config.feed === 'mock'
        ? MOCK_ALPACA_CREDENTIALS
        : {
            key: this.config.credentials?.apiKey,
            secret: this.config.credentials?.apiSecret,
          };
    if (!credentials.key || !credentials.secret)
      throw new Error('history_credentials_missing');
    endpoint.searchParams.set('symbols', this.config.symbol);
    endpoint.searchParams.set('start', new Date(startMs).toISOString());
    endpoint.searchParams.set('end', new Date(endMs).toISOString());
    endpoint.searchParams.set(
      'feed',
      this.config.feed === 'mock' ? 'iex' : this.config.feed,
    );
    endpoint.searchParams.set('sort', 'asc');
    endpoint.searchParams.set('limit', String(this.config.historyPageSize));
    const result = new Map<string, MarketTick>();
    const tokens = new Set<string>();
    for (let page = 0; page <= this.config.recoveryMaxTicks; page++) {
      signal.throwIfAborted();
      const response = await fetch(endpoint, {
        signal,
        redirect: 'error',
        headers: {
          'APCA-API-KEY-ID': credentials.key,
          'APCA-API-SECRET-KEY': credentials.secret,
        },
      });
      if (!response.ok) throw new Error(`history_http_${response.status}`);
      // Limit response allocation independently from an untrusted Content-Length.
      const reader = response.body?.getReader();
      if (!reader) throw new Error('history_empty_response');
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > 8 * 1024 * 1024)
            throw new Error('history_response_limit');
          chunks.push(chunk.value);
        }
      } finally {
        await reader.cancel();
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
        trades?: Record<string, unknown[]>;
        next_page_token?: unknown;
      };
      const trades = body.trades?.[this.config.symbol] ?? [];
      if (
        body.trades === undefined ||
        (body.trades !== null &&
          (typeof body.trades !== 'object' || Array.isArray(body.trades))) ||
        !Array.isArray(trades) ||
        trades.length > this.config.historyPageSize
      )
        throw new Error('history_invalid_response');
      for (const raw of trades) {
        if (!raw || typeof raw !== 'object')
          throw new Error('history_invalid_trade');
        const normalized = this.adapter.normalize(
          { ...raw, S: this.config.symbol, T: 't' },
          Date.now(),
          true,
        );
        if (!normalized.ok)
          throw new Error(`history_invalid_${normalized.reason}`);
        const tick = normalized.tick;
        if (tick.eventTimeMs < startMs || tick.eventTimeMs > endMs)
          throw new Error('history_outside_interval');
        result.set(marketIdentity(tick), tick);
        if (result.size > this.config.recoveryMaxTicks)
          throw new Error('history_capacity');
      }
      const next = body.next_page_token;
      if (next === null || next === undefined || next === '')
        return orderMarketTicks([...result.values()]);
      if (typeof next !== 'string' || next.length > 4096 || tokens.has(next))
        throw new Error('history_invalid_cursor');
      tokens.add(next);
      endpoint.searchParams.set('page_token', next);
    }
    throw new Error('history_page_limit');
  }
}
