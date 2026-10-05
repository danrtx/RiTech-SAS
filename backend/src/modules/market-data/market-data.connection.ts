import { MarketDataFeed } from './market-data.config';

export type MarketDataConnectionState =
  | 'DISABLED'
  | 'CONNECTING'
  | 'AUTHENTICATING'
  | 'SUBSCRIBING'
  | 'LIVE'
  | 'DEGRADED'
  | 'FAILED'
  | 'STOPPED';

export type ConnectionFailureReason =
  | 'credentials_missing'
  | 'connect_timeout'
  | 'heartbeat_timeout'
  | 'auth_timeout'
  | 'subscribe_timeout'
  | 'transport_error'
  | 'send_failed'
  | 'http_upgrade_rejected'
  | 'connection_closed'
  | 'provider_error'
  | 'invalid_frame'
  | 'invalid_control'
  | 'subscription_mismatch'
  | 'stopped'
  | 'closing';

export interface ConnectionFailure {
  readonly reason: ConnectionFailureReason;
  readonly retryable: boolean;
  readonly providerCode?: number;
  readonly closeCode?: number;
  readonly httpStatus?: number;
}

/** Solo motivos permitidos: nunca conservar el error o texto original del proveedor. */
export class MarketDataConnectionError extends Error {
  readonly failure: Readonly<ConnectionFailure>;

  constructor(failure: ConnectionFailure) {
    super(`market_data_${failure.reason}`);
    this.name = 'MarketDataConnectionError';
    this.failure = Object.freeze({ ...failure });
  }
}

export interface MarketDataConnectionStatus {
  readonly state: MarketDataConnectionState;
  readonly provider: 'alpaca';
  readonly feed: MarketDataFeed;
  readonly symbol: 'QQQ' | 'FAKEPACA';
  readonly lastError?: Readonly<ConnectionFailure>;
}
