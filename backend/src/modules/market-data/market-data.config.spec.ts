import { envConfig } from '../../config/env.config';
import { parseMarketDataConfig } from './market-data.config';

describe('Configuración de market data', () => {
  afterEach(() => jest.restoreAllMocks());

  it('arranca deshabilitada, sin claves, con QQQ y el endpoint IEX', () => {
    const config = parseMarketDataConfig({});
    expect(config).toMatchObject({
      enabled: false,
      provider: 'alpaca',
      feed: 'iex',
      symbol: 'QQQ',
      wsUrl: 'wss://stream.data.alpaca.markets/v2/iex',
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

  it('exige ambas claves al habilitar el feed externo', () => {
    expect(() =>
      parseMarketDataConfig({ MARKET_DATA_ENABLED: 'true' }),
    ).toThrow('ALPACA_API_KEY');
    expect(() =>
      parseMarketDataConfig({
        MARKET_DATA_ENABLED: 'true',
        ALPACA_API_KEY: 'fake',
      }),
    ).toThrow('ALPACA_API_SECRET');
    const config = parseMarketDataConfig({
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
    const config = parseMarketDataConfig({ MARKET_DATA_FEED: 'test' });
    expect(config.symbol).toBe('FAKEPACA');
    expect(config.wsUrl).toBe('wss://stream.data.alpaca.markets/v2/test');
    expect(() =>
      parseMarketDataConfig({
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
});
