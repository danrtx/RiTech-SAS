import { MarketTick } from '../dto/market-tick.dto';

export const MARKET_DATA_ADAPTER = Symbol('MARKET_DATA_ADAPTER');

export type TickRejection =
  | 'symbol'
  | 'price'
  | 'volume'
  | 'id'
  | 'exchange'
  | 'conditions'
  | 'timestamp'
  | 'stale'
  | 'future'
  | 'currency'
  | 'message_type';

export type TickNormalization =
  | { ok: true; tick: MarketTick; eventTimeNs: bigint }
  | { ok: false; reason: TickRejection };

export interface MarketDataAdapter {
  normalize(
    message: Readonly<Record<string, unknown>>,
    receivedAtMs: number,
  ): TickNormalization;
}
