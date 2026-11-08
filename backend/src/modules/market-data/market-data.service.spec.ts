import { MarketDataConnectionError } from './market-data.connection';
import { MarketDataService } from './market-data.service';
import { MarketDataWsClient } from './market-data-ws.client';
import { MarketDataProcessor } from './market-data.processor';
import { parseMarketDataConfig } from './market-data.config';
import { Subject } from 'rxjs';
import { MarketDataConnectionStatus } from './market-data.connection';
import { Logger } from '@nestjs/common';

describe('Bootstrap del feed opcional', () => {
  it('conserva disponible el backend si la conexión falla', async () => {
    const failure = new MarketDataConnectionError({
      reason: 'transport_error',
      retryable: true,
    });
    const client = {
      start: jest.fn().mockRejectedValue(failure),
      getStatus: () => ({ state: 'DEGRADED' }),
    };
    const service = new MarketDataService(
      client as unknown as MarketDataWsClient,
      {} as MarketDataProcessor,
      parseMarketDataConfig({}),
    );
    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(client.start).toHaveBeenCalledTimes(1);
  });
});

describe('Recuperación automática del feed', () => {
  let status$: Subject<MarketDataConnectionStatus>;
  let state: 'LIVE' | 'DEGRADED' | 'FAILED';
  let client: {
    status$: Subject<MarketDataConnectionStatus>;
    data$: Subject<never>;
    start: jest.Mock;
    getStatus: jest.Mock;
  };
  let service: MarketDataService;
  const config = parseMarketDataConfig({
    MARKET_DATA_PROVIDER: 'alpaca',
    MARKET_DATA_ENABLED: 'true',
    MARKET_DATA_FEED: 'mock',
    MARKET_DATA_RECONNECT_BASE_MS: '100',
    MARKET_DATA_RECONNECT_MAX_MS: '400',
  });
  const emit = (next: typeof state) => {
    state = next;
    status$.next({ state, provider: 'alpaca', feed: 'mock', symbol: 'QQQ' });
  };

  beforeEach(async () => {
    jest.useFakeTimers();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    status$ = new Subject();
    state = 'LIVE';
    client = {
      status$,
      data$: new Subject<never>(),
      start: jest.fn().mockResolvedValue(undefined),
      getStatus: jest.fn(() => ({ state })),
    };
    service = new MarketDataService(
      client as unknown as MarketDataWsClient,
      {
        setLive: jest.fn(),
        invalidate: jest.fn(),
        whenIdle: jest.fn().mockResolvedValue(undefined),
      } as unknown as MarketDataProcessor,
      config,
    );
    service.onModuleInit();
    await service.onApplicationBootstrap();
  });

  afterEach(async () => {
    await service.onModuleDestroy();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('reintenta una sola vez por corte, autentica mediante start y registra recuperación', async () => {
    client.start.mockImplementation(async () => emit('LIVE'));
    emit('DEGRADED');
    emit('DEGRADED');
    await jest.advanceTimersByTimeAsync(99);
    expect(client.start).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(client.start).toHaveBeenCalledTimes(2);
    expect(service.getStatus()).toMatchObject({
      reconnectAttempts: 1,
      reconnects: 1,
      reconnectScheduled: false,
    });
    await jest.advanceTimersByTimeAsync(1000);
    expect(client.start).toHaveBeenCalledTimes(2);
  });

  it('aumenta la espera hasta el máximo y reinicia el backoff después de LIVE', async () => {
    client.start.mockRejectedValue(new Error('safe_test_error'));
    emit('DEGRADED');
    await jest.advanceTimersByTimeAsync(100);
    expect(client.start).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(199);
    expect(client.start).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(1);
    expect(client.start).toHaveBeenCalledTimes(3);
    client.start.mockImplementation(async () => emit('LIVE'));
    await jest.advanceTimersByTimeAsync(400);
    emit('DEGRADED');
    await jest.advanceTimersByTimeAsync(100);
    expect(service.getStatus()).toMatchObject({
      reconnects: 2,
      reconnectAttempts: 4,
    });
  });

  it('cancela un reintento ante un error permanente y al apagar el módulo', async () => {
    emit('DEGRADED');
    emit('FAILED');
    await jest.advanceTimersByTimeAsync(1000);
    expect(client.start).toHaveBeenCalledTimes(1);
    emit('DEGRADED');
    await service.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(1000);
    expect(client.start).toHaveBeenCalledTimes(1);
  });
});
