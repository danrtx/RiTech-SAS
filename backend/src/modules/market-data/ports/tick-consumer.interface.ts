import { MarketTick } from '../dto/market-tick.dto';

export const TICK_CONSUMER = Symbol('TICK_CONSUMER');

export class StaleTickDeliveryError extends Error {
  constructor() {
    super('market_data_stale_delivery');
  }
}

export type TickInvalidationReason =
  | 'connection_unavailable'
  | 'queue_overflow'
  | 'consumer_error'
  | 'consumer_timeout'
  | 'correction'
  | 'cancellation'
  | 'stale_delivery'
  | 'shutdown';

export interface TickDeliveryContext {
  /** Un consumidor asíncrono debe comprobarla antes de publicar o modificar estado. */
  readonly signal: AbortSignal;
  readonly recovery?: boolean;
  readonly restoreAnalysis?: boolean;
}

export interface TickConsumer {
  /** Resolver solo al aceptar el tick; rechazar si la entrega falla. */
  consume(tick: MarketTick, context?: TickDeliveryContext): Promise<void>;
  /** Descarta el análisis construido sobre datos incompletos o invalidados. */
  invalidate(reason: TickInvalidationReason): void;
}
