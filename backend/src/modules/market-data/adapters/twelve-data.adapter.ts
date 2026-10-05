import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { MARKET_DATA_CONFIG, MarketDataConfig } from '../market-data.config';
import {
  MarketDataAdapter,
  TickNormalization,
} from '../ports/market-data-adapter.interface';

/** Convierte precios de Twelve Data al contrato existente sin inventar operaciones. */
@Injectable()
export class TwelveDataAdapter implements MarketDataAdapter {
  constructor(
    @Inject(MARKET_DATA_CONFIG) private readonly config: MarketDataConfig,
  ) {}

  normalize(
    message: Readonly<Record<string, unknown>>,
    receivedAtMs: number,
  ): TickNormalization {
    if (message.event !== 'price') return { ok: false, reason: 'message_type' };
    if (message.symbol !== this.config.symbol)
      return { ok: false, reason: 'symbol' };
    if (message.currency !== 'USD') return { ok: false, reason: 'currency' };
    if (
      typeof message.price !== 'number' ||
      !Number.isFinite(message.price) ||
      message.price <= 0
    )
      return { ok: false, reason: 'price' };
    if (
      typeof message.exchange !== 'string' ||
      !/^[A-Za-z0-9 ._-]{1,64}$/.test(message.exchange)
    )
      return { ok: false, reason: 'exchange' };
    if (
      typeof message.timestamp !== 'number' ||
      !Number.isSafeInteger(message.timestamp) ||
      message.timestamp < 0
    )
      return { ok: false, reason: 'timestamp' };
    const eventTimeMs = message.timestamp * 1000;
    if (
      !Number.isSafeInteger(eventTimeMs) ||
      eventTimeMs > 8640000000000000 ||
      !Number.isSafeInteger(receivedAtMs)
    )
      return { ok: false, reason: 'timestamp' };
    const age = receivedAtMs - eventTimeMs;
    if (age > this.config.maxTickAgeMs) return { ok: false, reason: 'stale' };
    if (age < -this.config.futureToleranceMs)
      return { ok: false, reason: 'future' };
    // No hay ID de operación, condiciones ni volumen por operación en este feed.
    // Un precio puede volver a un valor anterior dentro del mismo segundo.
    // Un hash de precio/tiempo descartaría ese cambio legítimo: identificar la observación local.
    const eventId = `td:${randomUUID()}`;
    return {
      ok: true,
      eventTimeNs: BigInt(message.timestamp) * 1000000000n,
      tick: Object.freeze({
        schemaVersion: 1,
        provider: 'twelvedata',
        feed: this.config.feed,
        symbol: this.config.symbol,
        providerSymbol: this.config.symbol,
        kind: 'price',
        price: message.price,
        currency: 'USD',
        volume: 0,
        eventId,
        exchange: message.exchange,
        conditions: Object.freeze([]),
        eventTime: new Date(eventTimeMs).toISOString(),
        eventTimeMs,
        receivedAtMs,
      }),
    };
  }
}
