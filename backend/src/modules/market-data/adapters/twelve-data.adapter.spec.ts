import { TwelveDataAdapter } from './twelve-data.adapter';
import { parseMarketDataConfig } from '../market-data.config';
import {
  normalizedTick,
  TEST_TIME_MS as BASE,
} from '../testing/market-tick.fixture';

describe('Adaptador Twelve Data al contrato de ticks existente', () => {
  const adapter = new TwelveDataAdapter(
    parseMarketDataConfig({ MARKET_DATA_PROVIDER: 'twelvedata' }),
  );
  const price = {
    event: 'price',
    symbol: 'QQQ',
    currency: 'USD',
    exchange: 'NASDAQ',
    type: 'ETF',
    timestamp: BASE / 1000,
    price: 102,
  };

  it('conserva claves y tipos del tick, convierte segundos y no fabrica volumen de operación', () => {
    const result = adapter.normalize(
      { ...price, day_volume: 7000000 },
      BASE + 100,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unexpected_rejection');
    const types = (value: object) =>
      Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [
          key,
          Array.isArray(entry) ? 'array' : typeof entry,
        ]),
      );
    expect(types(result.tick)).toEqual(types(normalizedTick()));
    expect(result.tick).toMatchObject({
      provider: 'twelvedata',
      feed: 'realtime',
      kind: 'price',
      symbol: 'QQQ',
      price: 102,
      volume: 0,
      conditions: [],
      exchange: 'NASDAQ',
      eventTimeMs: BASE,
      receivedAtMs: BASE + 100,
    });
    expect(result.eventTimeNs).toBe(BigInt(BASE) * 1000000n);
    expect(result.tick.eventTime).toBe(new Date(BASE).toISOString());
    expect(result.tick.eventId).toMatch(/^td:/);
    expect(Object.isFrozen(result.tick)).toBe(true);
  });

  it('preserva observaciones A → B → A dentro del mismo segundo sin deduplicarlas como trades', () => {
    const results = [100, 101, 100].map((value) =>
      adapter.normalize({ ...price, price: value }, BASE),
    );
    const ids = results.map((result) =>
      result.ok ? result.tick.eventId : undefined,
    );
    expect(new Set(ids).size).toBe(3);
  });

  it.each([
    [{ symbol: 'NDX' }, 'symbol'],
    [{ currency: 'EUR' }, 'currency'],
    [{ event: 'heartbeat' }, 'message_type'],
    [{ price: '102' }, 'price'],
    [{ price: 0 }, 'price'],
    [{ price: Infinity }, 'price'],
    [{ exchange: '' }, 'exchange'],
    [{ exchange: 'bad\nexchange' }, 'exchange'],
    [{ timestamp: '1700000000' }, 'timestamp'],
    [{ timestamp: NaN }, 'timestamp'],
    [{ timestamp: BASE / 1000 + 0.5 }, 'timestamp'],
    [{ timestamp: -1 }, 'timestamp'],
    [{ timestamp: Number.MAX_SAFE_INTEGER }, 'timestamp'],
    [{ timestamp: BASE / 1000 - 2 }, 'stale'],
    [{ timestamp: BASE / 1000 + 1 }, 'future'],
  ])('rechaza %j con motivo seguro %s', (override, reason) => {
    expect(adapter.normalize({ ...price, ...override }, BASE)).toEqual({
      ok: false,
      reason,
    });
  });
});
