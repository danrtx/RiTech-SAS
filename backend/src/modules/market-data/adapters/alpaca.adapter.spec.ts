import { AlpacaAdapter, parseEventTime } from './alpaca.adapter';
import { parseMarketDataConfig } from '../market-data.config';
import { createTradeFixture } from '../testing/alpaca.fixtures';

describe('Adaptador Alpaca', () => {
  const adapter = new AlpacaAdapter(
    parseMarketDataConfig({ MARKET_DATA_FEED: 'mock' }),
  );
  const wire = createTradeFixture();
  const time = Date.parse(wire.t);

  it('normaliza la operación y conserva nanosegundos, condiciones y cantidad', () => {
    const result = adapter.normalize({ ...wire }, time + 10);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Tick rechazado');
    expect(result.tick).toMatchObject({
      eventTime: wire.t,
      eventTimeMs: time,
      eventId: '1',
      volume: 10,
      price: 550.25,
      feed: 'mock',
      receivedAtMs: time + 10,
    });
    expect(result.eventTimeNs % 1000000000n).toBe(123456789n);
    expect(Object.isFrozen(result.tick)).toBe(true);
    expect(Object.isFrozen(result.tick.conditions)).toBe(true);
  });

  it.each([
    ['S', 'NDX', 'symbol'],
    ['p', -1, 'price'],
    ['p', '100', 'price'],
    ['p', NaN, 'price'],
    ['p', Infinity, 'price'],
    ['s', 0, 'volume'],
    ['s', 1.5, 'volume'],
    ['i', Number.MAX_SAFE_INTEGER + 1, 'id'],
    ['i', '10', 'id'],
    ['i', -1, 'id'],
    ['x', 'sentinel-secret', 'exchange'],
    ['c', ['sentinel-secret'], 'conditions'],
    ['c', undefined, 'conditions'],
    ['t', undefined, 'timestamp'],
    ['t', '2026-02-30T14:00:00Z', 'timestamp'],
    ['t', '2026-10-05T25:00:00Z', 'timestamp'],
    ['t', '2026-10-05T14:00:00.1234567890Z', 'timestamp'],
  ])('rechaza %s inválido por motivo seguro', (field, value, reason) => {
    expect(adapter.normalize({ ...wire, [field]: value }, time)).toEqual({
      ok: false,
      reason,
    });
  });

  it('aplica límites de frescura y tolerancia futura', () => {
    expect(adapter.normalize({ ...wire }, time + 1000).ok).toBe(true);
    expect(adapter.normalize({ ...wire }, time + 1001)).toEqual({
      ok: false,
      reason: 'stale',
    });
    expect(adapter.normalize({ ...wire }, time - 100).ok).toBe(true);
    expect(adapter.normalize({ ...wire }, time - 101)).toEqual({
      ok: false,
      reason: 'future',
    });
  });

  it('interpreta offsets y valida calendario sin normalizar fechas inexistentes', () => {
    expect(parseEventTime('2026-10-05T09:00:00.123456789-05:00')).toEqual(
      parseEventTime(wire.t),
    );
    expect(parseEventTime('2024-02-29T00:00:00Z')).toBeDefined();
    expect(parseEventTime('2025-02-29T00:00:00Z')).toBeUndefined();
    expect(parseEventTime('2026-10-05T14:00:00+24:00')).toBeUndefined();
  });
});
