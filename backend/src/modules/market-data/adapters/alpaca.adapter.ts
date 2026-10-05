import { Inject, Injectable } from '@nestjs/common';
import { MARKET_DATA_CONFIG, MarketDataConfig } from '../market-data.config';
import { MarketTick } from '../dto/market-tick.dto';

export type TickRejection =
  | 'symbol'
  | 'price'
  | 'volume'
  | 'id'
  | 'exchange'
  | 'conditions'
  | 'timestamp'
  | 'stale'
  | 'future';
export type TradeResult =
  | { ok: true; tick: MarketTick; eventTimeNs: bigint }
  | { ok: false; reason: TickRejection };

/** Parse estricto: Date.parse por sí solo normaliza fechas de calendario inválidas. */
export function parseEventTime(
  value: unknown,
): { ms: number; ns: bigint } | undefined {
  if (typeof value !== 'string') return;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (!match) return;
  const [, y, m, d, h, min, sec, fraction = '', zone] = match;
  const [year, month, day, hour, minute, second] = [y, m, d, h, min, sec].map(
    Number,
  );
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  )
    return;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return;
  let offset = 0;
  if (zone !== 'Z') {
    const offsetHours = Number(zone.slice(1, 3));
    const offsetMinutes = Number(zone.slice(4, 6));
    if (offsetHours > 23 || offsetMinutes > 59) return;
    offset = (offsetHours * 60 + offsetMinutes) * (zone[0] === '+' ? 1 : -1);
  }
  const secondsMs = date.getTime() - offset * 60000;
  const nsFraction = BigInt(fraction.padEnd(9, '0'));
  return {
    ms: secondsMs + Number(nsFraction / 1000000n),
    ns: BigInt(secondsMs) * 1000000n + nsFraction,
  };
}

@Injectable()
export class AlpacaAdapter {
  constructor(
    @Inject(MARKET_DATA_CONFIG) private readonly config: MarketDataConfig,
  ) {}

  normalize(
    message: Readonly<Record<string, unknown>>,
    receivedAtMs: number,
  ): TradeResult {
    if (message.S !== this.config.symbol)
      return { ok: false, reason: 'symbol' };
    if (
      typeof message.p !== 'number' ||
      !Number.isFinite(message.p) ||
      message.p <= 0
    )
      return { ok: false, reason: 'price' };
    if (
      typeof message.s !== 'number' ||
      !Number.isSafeInteger(message.s) ||
      message.s <= 0
    )
      return { ok: false, reason: 'volume' };
    if (
      typeof message.i !== 'number' ||
      !Number.isSafeInteger(message.i) ||
      message.i < 0
    )
      return { ok: false, reason: 'id' };
    if (typeof message.x !== 'string' || !/^[A-Z]$/.test(message.x))
      return { ok: false, reason: 'exchange' };
    if (
      !Array.isArray(message.c) ||
      message.c.length > 16 ||
      message.c.some((c) => typeof c !== 'string' || !/^[\x20-\x7e]$/.test(c))
    )
      return { ok: false, reason: 'conditions' };
    const time = parseEventTime(message.t);
    if (!time || !Number.isSafeInteger(receivedAtMs))
      return { ok: false, reason: 'timestamp' };
    const age = receivedAtMs - time.ms;
    if (age > this.config.maxTickAgeMs) return { ok: false, reason: 'stale' };
    if (age < -this.config.futureToleranceMs)
      return { ok: false, reason: 'future' };
    return {
      ok: true,
      eventTimeNs: time.ns,
      tick: Object.freeze({
        schemaVersion: 1,
        provider: 'alpaca',
        feed: this.config.feed,
        symbol: this.config.symbol,
        providerSymbol: this.config.symbol,
        kind: 'trade',
        price: message.p,
        currency: 'USD',
        volume: message.s,
        eventId: String(message.i),
        exchange: message.x,
        conditions: Object.freeze([...message.c]) as readonly string[],
        eventTime: message.t as string,
        eventTimeMs: time.ms,
        receivedAtMs,
      }),
    };
  }
}
