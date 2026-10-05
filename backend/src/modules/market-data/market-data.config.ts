export const MARKET_DATA_CONFIG = Symbol('MARKET_DATA_CONFIG');

export type MarketDataFeed = 'iex' | 'test' | 'mock';

export interface MarketDataConfig {
  readonly enabled: boolean;
  readonly provider: 'alpaca';
  readonly feed: MarketDataFeed;
  readonly wsUrl: string;
  readonly symbol: 'QQQ' | 'FAKEPACA';
  readonly credentials?: Readonly<{ apiKey: string; apiSecret: string }>;
  readonly connectTimeoutMs: number;
  readonly authTimeoutMs: number;
  readonly subscribeTimeoutMs: number;
  readonly closeTimeoutMs: number;
  readonly reconnectBaseMs: number;
  readonly reconnectMaxMs: number;
  readonly heartbeatMs: number;
  readonly heartbeatTimeoutMs: number;
  readonly maxTickAgeMs: number;
  readonly queueCapacity: number;
  readonly consumerTimeoutMs: number;
  readonly futureToleranceMs: number;
  readonly dedupCapacity: number;
  readonly historyRetentionMs: number;
  readonly historyCapacity: number;
  readonly referenceToleranceMs: number;
  readonly maxAlertRules: number;
  readonly recoveryTimeoutMs: number;
  readonly recoveryMaxTicks: number;
  readonly recoveryMaxGapMs: number;
  readonly historyPageSize: number;
}

type Environment = Readonly<Record<string, string | undefined>>;

const ENDPOINTS: Record<MarketDataFeed, string> = {
  iex: 'wss://stream.data.alpaca.markets/v2/iex',
  test: 'wss://stream.data.alpaca.markets/v2/test',
  mock: 'ws://127.0.0.1:8765/v2/mock',
};

function invalid(variable: string, reason: string): never {
  // Nunca incluir el valor recibido: una URL o variable puede contener secretos.
  throw new Error(`Configuración market data inválida: ${variable} ${reason}`);
}

function positiveInteger(
  env: Environment,
  name: string,
  fallback: number,
): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  if (!/^[1-9]\d*$/.test(raw)) invalid(name, 'debe ser un entero positivo');
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) invalid(name, 'excede el rango seguro');
  return value;
}

function validateUrl(raw: string, feed: MarketDataFeed): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    invalid('MARKET_DATA_WS_URL', 'debe ser una URL válida');
  }
  if (url.username || url.password || url.search || url.hash) {
    invalid('MARKET_DATA_WS_URL', 'no admite credenciales, query ni fragmento');
  }
  if (feed !== 'mock') {
    if (raw !== ENDPOINTS[feed]) {
      invalid(
        'MARKET_DATA_WS_URL',
        'debe coincidir con el endpoint del feed seleccionado',
      );
    }
    return;
  }
  if (
    url.protocol !== 'ws:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    !url.port ||
    Number(url.port) === 0 ||
    url.pathname !== '/v2/mock'
  ) {
    invalid(
      'MARKET_DATA_WS_URL',
      'para mock debe usar ws, loopback, puerto y /v2/mock',
    );
  }
}

export function parseMarketDataConfig(
  env: Environment = process.env,
): MarketDataConfig {
  const enabledValue = env.MARKET_DATA_ENABLED?.trim() || 'false';
  if (enabledValue !== 'true' && enabledValue !== 'false') {
    invalid('MARKET_DATA_ENABLED', 'debe ser true o false');
  }
  const enabled = enabledValue === 'true';
  const provider = env.MARKET_DATA_PROVIDER?.trim() || 'alpaca';
  if (provider !== 'alpaca') invalid('MARKET_DATA_PROVIDER', 'debe ser alpaca');

  const feedValue = env.MARKET_DATA_FEED?.trim() || 'iex';
  if (!['iex', 'test', 'mock'].includes(feedValue)) {
    invalid('MARKET_DATA_FEED', 'debe ser iex, test o mock');
  }
  const feed = feedValue as MarketDataFeed;
  if (enabled && env.NODE_ENV === 'production' && feed !== 'iex') {
    invalid('MARKET_DATA_FEED', 'en producción debe ser iex');
  }
  const expectedSymbol = feed === 'test' ? 'FAKEPACA' : 'QQQ';
  const symbol = env.MARKET_DATA_SYMBOL?.trim() || expectedSymbol;
  if (symbol !== expectedSymbol) {
    invalid('MARKET_DATA_SYMBOL', 'no corresponde al feed seleccionado');
  }
  const wsUrl = env.MARKET_DATA_WS_URL?.trim() || ENDPOINTS[feed];
  validateUrl(wsUrl, feed);

  let credentials: MarketDataConfig['credentials'];
  if (enabled && feed !== 'mock') {
    const apiKey = env.ALPACA_API_KEY?.trim();
    const apiSecret = env.ALPACA_API_SECRET?.trim();
    if (!apiKey)
      invalid(
        'ALPACA_API_KEY',
        'es obligatoria con ingesta externa habilitada',
      );
    if (!apiSecret)
      invalid(
        'ALPACA_API_SECRET',
        'es obligatorio con ingesta externa habilitada',
      );
    credentials = Object.freeze({ apiKey, apiSecret });
  }

  const reconnectBaseMs = positiveInteger(
    env,
    'MARKET_DATA_RECONNECT_BASE_MS',
    100,
  );
  const reconnectMaxMs = positiveInteger(
    env,
    'MARKET_DATA_RECONNECT_MAX_MS',
    5000,
  );
  if (reconnectMaxMs < reconnectBaseMs) {
    invalid(
      'MARKET_DATA_RECONNECT_MAX_MS',
      'debe ser mayor o igual a la espera base',
    );
  }
  const authTimeoutMs = positiveInteger(
    env,
    'MARKET_DATA_AUTH_TIMEOUT_MS',
    5000,
  );
  if (authTimeoutMs > 10000) {
    invalid('MARKET_DATA_AUTH_TIMEOUT_MS', 'no debe superar 10000 ms');
  }
  const phaseTimeout = (name: string, fallback: number): number => {
    const value = positiveInteger(env, name, fallback);
    if (value > 2147483647)
      invalid(name, 'excede el rango de temporizadores de Node.js');
    return value;
  };
  const boundedInteger = (
    name: string,
    fallback: number,
    min: number,
    max: number,
  ): number => {
    const value = positiveInteger(env, name, fallback);
    if (value < min || value > max)
      invalid(name, 'está fuera del rango permitido');
    return value;
  };
  const historyRetentionMs = boundedInteger(
    'MARKET_DATA_HISTORY_RETENTION_MS',
    3600000,
    1000,
    86400000,
  );

  return Object.freeze({
    enabled,
    provider,
    feed,
    wsUrl,
    symbol,
    credentials,
    connectTimeoutMs: phaseTimeout('MARKET_DATA_CONNECT_TIMEOUT_MS', 10000),
    authTimeoutMs,
    subscribeTimeoutMs: phaseTimeout('MARKET_DATA_SUBSCRIBE_TIMEOUT_MS', 5000),
    closeTimeoutMs: phaseTimeout('MARKET_DATA_CLOSE_TIMEOUT_MS', 1000),
    reconnectBaseMs,
    reconnectMaxMs,
    heartbeatMs: phaseTimeout('MARKET_DATA_HEARTBEAT_MS', 500),
    heartbeatTimeoutMs: phaseTimeout('MARKET_DATA_HEARTBEAT_TIMEOUT_MS', 500),
    maxTickAgeMs: positiveInteger(env, 'MARKET_DATA_MAX_TICK_AGE_MS', 1000),
    queueCapacity: positiveInteger(env, 'MARKET_DATA_QUEUE_CAPACITY', 1000),
    consumerTimeoutMs: phaseTimeout('MARKET_DATA_CONSUMER_TIMEOUT_MS', 100),
    futureToleranceMs: positiveInteger(
      env,
      'MARKET_DATA_FUTURE_TOLERANCE_MS',
      100,
    ),
    dedupCapacity: boundedInteger(
      'MARKET_DATA_DEDUP_CAPACITY',
      200000,
      1,
      1000000,
    ),
    historyRetentionMs,
    historyCapacity: boundedInteger(
      'MARKET_DATA_HISTORY_CAPACITY',
      100000,
      2,
      1000000,
    ),
    referenceToleranceMs: boundedInteger(
      'MARKET_DATA_REFERENCE_TOLERANCE_MS',
      Math.min(5000, historyRetentionMs),
      1,
      historyRetentionMs,
    ),
    maxAlertRules: boundedInteger('MARKET_DATA_MAX_ALERT_RULES', 20, 1, 100),
    recoveryTimeoutMs: boundedInteger('MARKET_DATA_RECOVERY_TIMEOUT_MS', 10000, 100, 120000),
    recoveryMaxTicks: boundedInteger('MARKET_DATA_RECOVERY_MAX_TICKS', 100000, 1, 1000000),
    recoveryMaxGapMs: boundedInteger('MARKET_DATA_RECOVERY_MAX_GAP_MS', 3600000, 1000, 86400000),
    historyPageSize: boundedInteger('MARKET_DATA_HISTORY_PAGE_SIZE', 1000, 1, 10000),
  });
}
