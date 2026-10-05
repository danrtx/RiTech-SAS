import { MarketTick } from '../dto/market-tick.dto';

export const TICK_CONSUMER = Symbol('TICK_CONSUMER');

export interface TickConsumer {
  /** Resolver solo al aceptar el tick; rechazar si la entrega falla. */
  consume(tick: MarketTick): Promise<void>;
}
