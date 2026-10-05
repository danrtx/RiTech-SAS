import { MarketDataFeed, MarketDataProvider } from '../market-data.config';

/** Contrato normalizado; la validación del mensaje entrante pertenece al adaptador. */
export interface MarketTick {
  readonly schemaVersion: 1;
  readonly provider: MarketDataProvider;
  readonly feed: MarketDataFeed;
  readonly symbol: string;
  readonly providerSymbol: string;
  readonly kind: 'trade' | 'price';
  readonly price: number;
  readonly currency: 'USD';
  /** Cantidad de la operación; 0 = no disponible en eventos price de Twelve Data. */
  readonly volume: number;
  readonly eventId: string;
  readonly exchange: string;
  readonly conditions: readonly string[];
  /** RFC 3339 original, conservando la precisión del proveedor. */
  readonly eventTime: string;
  readonly eventTimeMs: number;
  readonly receivedAtMs: number;
}
