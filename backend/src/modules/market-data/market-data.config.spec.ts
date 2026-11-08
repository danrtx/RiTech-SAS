import { envConfig } from '../../config/env.config';
import { parseMarketDataConfig } from './market-data.config';

describe('Configuración de market data', () => {
  afterEach(() => jest.restoreAllMocks());

  it('usa solo Twelve Data por defecto aunque existan credenciales opcionales de Alpaca', () => {
    const env = {
      MARKET_DATA_ENABLED: 'true',
      TWELVE_DATA_API_KEY: 'twelve-only',
      ALPACA_API_KEY: 'unused-alpaca',
      ALPACA_API_SECRET: 'unused-secret',
    };
    expect(parseMarketDataConfig(env)).toMatchObject({
      provider: 'twelvedata',
      feed: 'realtime',
      credentials: { apiKey: 'twelve-only' },
    });
    expect(parseMarketDataConfig(env).credentials).not.toHaveProperty(
      'apiSecret',
    );
    expect(() =>
      parseMarketDataConfig({ ...env, TWELVE_DATA_API_KEY: '' }),
    ).toThrow('TWELVE_DATA_API_KEY');
  });

  it('selecciona Twelve Data con una sola clave y endpoint sin credenciales', () => {
    const config = parseMarketDataConfig({
      MARKET_DATA_PROVIDER: 'twelvedata',
      MARKET_DATA_ENABLED: 'true',
      TWELVE_DATA_API_KEY: 'sentinel-key',
      ALPACA_API_SECRET: 'unused-secret',
    });
    expect(config).toMatchObject({
      provider: 'twelvedata',
      feed: 'realtime',
      symbol: 'QQQ',
      wsUrl: 'wss://ws.twelvedata.com/v1/quotes/price',
      credentials: { apiKey: 'sentinel-key' },
      heartbeatMs: 10000,
    });
    expect(config.credentials).not.toHaveProperty('apiSecret');
    expect(config.wsUrl).not.toContain('sentinel-key');
    expect(() =>
      parseMarketDataConfig({
        MARKET_DATA_PROVIDER: 'twelvedata',
        MARKET_DATA_ENABLED: 'true',
      }),
    ).toThrow('TWELVE_DATA_API_KEY');
  });

  it.each(['iex', 'test'])(
    'rechaza el feed Alpaca %s con Twelve Data',
    (feed) => {
      expect(() =>
        parseMarketDataConfig({
          MARKET_DATA_PROVIDER: 'twelvedata',
          MARKET_DATA_FEED: feed,
        }),
      ).toThrow('MARKET_DATA_FEED');
    },
  );

  it('no acepta URLs externas con clave ni reutiliza credenciales reales en mock Twelve Data', () => {
    expect(() =>
      parseMarketDataConfig({
        MARKET_DATA_PROVIDER: 'twelvedata',
        MARKET_DATA_WS_URL:
          'wss://ws.twelvedata.com/v1/quotes/price?apikey=sentinel-key',
      }),
    ).toThrow('MARKET_DATA_WS_URL');
    const config = parseMarketDataConfig({
      MARKET_DATA_PROVIDER: 'twelvedata',
      MARKET_DATA_FEED: 'mock',
      MARKET_DATA_ENABLED: 'true',
      TWELVE_DATA_API_KEY: 'sentinel-key',
    });
    expect(config.credentials).toBeUndefined();
    expect(JSON.stringify(config)).not.toContain('sentinel-key');
  });

  it('arranca deshabilitada, sin claves, con QQQ y Twelve Data por defecto', () => {
    const config = parseMarketDataConfig({});
    expect(config).toMatchObject({
      enabled: false,
      provider: 'twelvedata',
      feed: 'realtime',
      symbol: 'QQQ',
      wsUrl: 'wss://ws.twelvedata.com/v1/quotes/price',
      credentials: undefined,
    });
    expect(Object.isFrozen(config)).toBe(true);
  });

  it('integra la validación en la fábrica global de configuración', () => {
    jest.replaceProperty(process, 'env', {});
    expect(envConfig().marketData.enabled).toBe(false);
    process.env.MARKET_DATA_QUEUE_CAPACITY = '10ms';
    expect(() => envConfig()).toThrow('MARKET_DATA_QUEUE_CAPACITY');
  });

  it('exige ambas claves solo al elegir Alpaca explícitamente', () => {
    expect(() =>
      parseMarketDataConfig({
        MARKET_DATA_PROVIDER: 'alpaca',
        MARKET_DATA_ENABLED: 'true',
      }),
    ).toThrow('ALPACA_API_KEY');
    expect(() =>
      parseMarketDataConfig({
        MARKET_DATA_PROVIDER: 'alpaca',
        MARKET_DATA_ENABLED: 'true',
        ALPACA_API_KEY: 'fake',
      }),
    ).toThrow('ALPACA_API_SECRET');
    const config = parseMarketDataConfig({
      MARKET_DATA_PROVIDER: 'alpaca',
      MARKET_DATA_ENABLED: 'true',
      ALPACA_API_KEY: 'fake-key',
      ALPACA_API_SECRET: 'fake-secret',
      MARKET_DATA_QUEUE_CAPACITY: '200',
    });
    expect(config.credentials).toEqual({
      apiKey: 'fake-key',
      apiSecret: 'fake-secret',
    });
    expect(Object.isFrozen(config.credentials)).toBe(true);
    expect(config.queueCapacity).toBe(200);
  });

  it('mantiene FAKEPACA separado del feed QQQ', () => {
    const config = parseMarketDataConfig({
      MARKET_DATA_PROVIDER: 'alpaca',
      MARKET_DATA_FEED: 'test',
    });
    expect(config.symbol).toBe('FAKEPACA');
    expect(config.wsUrl).toBe('wss://stream.data.alpaca.markets/v2/test');
    expect(() =>
      parseMarketDataConfig({
        MARKET_DATA_PROVIDER: 'alpaca',
        MARKET_DATA_FEED: 'test',
        MARKET_DATA_SYMBOL: 'QQQ',
      }),
    ).toThrow('MARKET_DATA_SYMBOL');
  });

  it('habilita el mock local sin guardar claves reales', () => {
    const config = parseMarketDataConfig({
      MARKET_DATA_ENABLED: 'true',
      MARKET_DATA_FEED: 'mock',
      MARKET_DATA_WS_URL: 'ws://localhost:9000/v2/mock',
      ALPACA_API_KEY: 'sentinel-key',
      ALPACA_API_SECRET: 'sentinel-secret',
    });
    expect(config.credentials).toBeUndefined();
    expect(config.symbol).toBe('QQQ');
    expect(
      parseMarketDataConfig({ ALPACA_API_KEY: 'sentinel-key' }).credentials,
    ).toBeUndefined();
  });

  it.each(['test', 'mock'])(
    'rechaza el feed %s habilitado en producción',
    (feed) => {
      expect(() =>
        parseMarketDataConfig({
          NODE_ENV: 'production',
          MARKET_DATA_ENABLED: 'true',
          MARKET_DATA_FEED: feed,
        }),
      ).toThrow('MARKET_DATA_FEED');
    },
  );

  it.each([
    ['MARKET_DATA_ENABLED', '1'],
    ['MARKET_DATA_PROVIDER', 'tradingview'],
    ['MARKET_DATA_FEED', 'sip'],
    ['MARKET_DATA_SYMBOL', 'NDX'],
    ['MARKET_DATA_WS_URL', 'wss://stream.data.alpaca.markets/v2/test'],
    ['MARKET_DATA_QUEUE_CAPACITY', '0'],
    ['MARKET_DATA_QUEUE_CAPACITY', '-2'],
    ['MARKET_DATA_HEARTBEAT_MS', '1.5'],
    ['MARKET_DATA_HEARTBEAT_TIMEOUT_MS', '100ms'],
    ['MARKET_DATA_MAX_TICK_AGE_MS', '9007199254740992'],
    ['MARKET_DATA_CONSUMER_TIMEOUT_MS', 'NaN'],
    ['MARKET_DATA_RECONNECT_BASE_MS', 'Infinity'],
  ])(
    'rechaza %s inválida sin aceptar conversiones parciales',
    (name, value) => {
      expect(() => parseMarketDataConfig({ [name]: value })).toThrow(name);
    },
  );

  it.each([
    'ws://example.com:8765/v2/mock',
    'wss://127.0.0.1:8765/v2/mock',
    'ws://127.0.0.1:0/v2/mock',
    'ws://127.0.0.1:8765/otro',
    'ws://sentinel-secret@127.0.0.1:8765/v2/mock',
    'ws://127.0.0.1:8765/v2/mock?key=sentinel-secret',
    'sentinel-secret',
  ])('rechaza URL mock insegura o incoherente y oculta valores: %s', (url) => {
    const parse = () =>
      parseMarketDataConfig({
        MARKET_DATA_FEED: 'mock',
        MARKET_DATA_WS_URL: url,
      });
    expect(parse).toThrow('MARKET_DATA_WS_URL');
    try {
      parse();
    } catch (error) {
      expect((error as Error).message).not.toContain('sentinel-secret');
    }
  });

  it('rechaza un máximo de reconexión inferior a la espera inicial', () => {
    expect(() =>
      parseMarketDataConfig({
        MARKET_DATA_RECONNECT_BASE_MS: '200',
        MARKET_DATA_RECONNECT_MAX_MS: '100',
      }),
    ).toThrow('MARKET_DATA_RECONNECT_MAX_MS');
  });

  it.each([
    ['MARKET_DATA_CONNECT_TIMEOUT_MS', '0'],
    ['MARKET_DATA_CONNECT_TIMEOUT_MS', '2147483648'],
    ['MARKET_DATA_AUTH_TIMEOUT_MS', '10001'],
    ['MARKET_DATA_SUBSCRIBE_TIMEOUT_MS', '1ms'],
    ['MARKET_DATA_CLOSE_TIMEOUT_MS', '-1'],
    ['MARKET_DATA_HEARTBEAT_MS', '2147483648'],
    ['MARKET_DATA_HEARTBEAT_TIMEOUT_MS', '0'],
  ])('rechaza un timeout de conexión inválido en %s', (name, value) => {
    expect(() => parseMarketDataConfig({ [name]: value })).toThrow(name);
  });

  it.each([
    ['MARKET_DATA_HISTORY_CAPACITY', '1000001'],
    ['MARKET_DATA_HISTORY_CAPACITY', '1'],
    ['MARKET_DATA_HISTORY_RETENTION_MS', '999'],
    ['MARKET_DATA_HISTORY_RETENTION_MS', '86400001'],
    ['MARKET_DATA_DEDUP_CAPACITY', '1000001'],
    ['MARKET_DATA_REFERENCE_TOLERANCE_MS', '3600001'],
    ['MARKET_DATA_MAX_ALERT_RULES', '101'],
    ['MARKET_DATA_CONSUMER_TIMEOUT_MS', '2147483648'],
  ])('limita recursos y temporizadores de análisis en %s', (name, value) => {
    expect(() => parseMarketDataConfig({ [name]: value })).toThrow(name);
  });
});
