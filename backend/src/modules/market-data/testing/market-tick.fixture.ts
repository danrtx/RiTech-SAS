import { MarketTick } from '../dto/market-tick.dto';

export const TEST_TIME_MS = Date.UTC(2026, 9, 5, 14);

export function normalizedTick(
  timeMs = TEST_TIME_MS,
  price = 100,
  id = String(timeMs),
): MarketTick {
  return Object.freeze({
    schemaVersion: 1,
    provider: 'alpaca',
    feed: 'mock',
    symbol: 'QQQ',
    providerSymbol: 'QQQ',
    kind: 'trade',
    price,
    currency: 'USD',
    volume: 10,
    eventId: id,
    exchange: 'V',
    conditions: Object.freeze(['@']),
    eventTime: new Date(timeMs).toISOString(),
    eventTimeMs: timeMs,
    receivedAtMs: timeMs,
  });
}
