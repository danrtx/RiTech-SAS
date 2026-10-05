/** Contrato interno de mensajes crudos. No es un DTO de la API pública. */
export interface MarketDataMessage {
  readonly T: 't' | 'c' | 'x' | 'price';
  readonly [field: string]: unknown;
}

export interface MarketDataBatch {
  readonly messages: readonly MarketDataMessage[];
  readonly receivedAtMs: number;
  readonly receivedAtMonotonicMs: number;
}
