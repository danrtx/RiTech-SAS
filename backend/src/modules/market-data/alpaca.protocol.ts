// Credenciales públicas y ficticias; válidas solo para el mock local.
export const MOCK_ALPACA_CREDENTIALS = Object.freeze({
  key: 'mock-api-key',
  secret: 'mock-api-secret',
});

/** Mensajes sin normalizar: precio, símbolo, ID y timestamp aún no están validados. */
export interface AlpacaDataMessage {
  readonly T: 't' | 'c' | 'x';
  readonly [field: string]: unknown;
}

export type { MarketDataBatch as AlpacaDataBatch } from './market-data.protocol';
