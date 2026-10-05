import { Logger } from '@nestjs/common';
import { firstValueFrom, filter, timeout } from 'rxjs';
import { ClientOptions, WebSocket } from 'ws';
import { parseMarketDataConfig } from './market-data.config';
import { MarketDataWsClient } from './market-data-ws.client';
import { TwelveDataMockServer } from './testing/twelve-data-mock.server';

describe('WebSocket Twelve Data', () => {
  let mock: TwelveDataMockServer;
  let client: MarketDataWsClient;
  let logs: string[];

  beforeEach(() => {
    logs = [];
    jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation((message) => logs.push(String(message)));
    jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation((message) => logs.push(String(message)));
  });
  afterEach(async () => {
    await client?.onModuleDestroy();
    await mock?.stop();
    jest.restoreAllMocks();
  });

  async function setup(
    options: ConstructorParameters<typeof TwelveDataMockServer>[0] = {},
    env: Record<string, string> = {},
  ) {
    mock = new TwelveDataMockServer(options);
    const url = await mock.start();
    client = new MarketDataWsClient(
      parseMarketDataConfig({
        MARKET_DATA_ENABLED: 'true',
        MARKET_DATA_PROVIDER: 'twelvedata',
        MARKET_DATA_FEED: 'mock',
        MARKET_DATA_WS_URL: url,
        MARKET_DATA_HEARTBEAT_MS: '20',
        MARKET_DATA_HEARTBEAT_TIMEOUT_MS: '50',
        ...env,
      }),
    );
    return url;
  }

  it('autentica en la URL, suscribe QQQ una vez y recibe precios y heartbeat', async () => {
    await setup();
    await Promise.all([client.start(), client.start()]);
    expect(client.getStatus()).toMatchObject({
      state: 'LIVE',
      provider: 'twelvedata',
    });
    expect(mock.connections).toBe(1);
    expect(
      mock.commands.filter((command) => command.action === 'subscribe'),
    ).toEqual([{ action: 'subscribe', params: { symbols: 'QQQ' } }]);
    const batch = firstValueFrom(client.data$.pipe(timeout(1000)));
    mock.publish(102);
    expect((await batch).messages[0]).toMatchObject({
      T: 'price',
      event: 'price',
      symbol: 'QQQ',
      price: 102,
    });
    await new Promise((resolve) => setTimeout(resolve, 85));
    expect(
      mock.commands.some((command) => command.action === 'heartbeat'),
    ).toBe(true);
    expect(client.getStatus().state).toBe('LIVE');
    expect(logs.join('\n')).not.toContain('apikey');
    expect(logs.join('\n')).not.toContain('mock-twelve-api-key');
  });

  it('autentica el proveedor real sin guardar la URL con clave en el estado o los logs', async () => {
    const url = await setup();
    await client.onModuleDestroy();
    const factory = jest.fn(
      (_endpoint: string, options: ClientOptions) =>
        new WebSocket(`${url}?apikey=mock-twelve-api-key`, options),
    );
    client = new MarketDataWsClient(
      parseMarketDataConfig({
        MARKET_DATA_ENABLED: 'true',
        MARKET_DATA_PROVIDER: 'twelvedata',
        TWELVE_DATA_API_KEY: 'sentinel-secret',
      }),
      factory,
    );
    await client.start();
    expect(new URL(factory.mock.calls[0][0]).searchParams.get('apikey')).toBe(
      'sentinel-secret',
    );
    expect(client.getStatus()).toMatchObject({
      state: 'LIVE',
      feed: 'realtime',
    });
    expect(JSON.stringify(client.getStatus()) + logs.join('\n')).not.toContain(
      'sentinel-secret',
    );
  });

  it.each([
    [401, 'FAILED'],
    [403, 'FAILED'],
    [429, 'DEGRADED'],
    [500, 'DEGRADED'],
  ])(
    'clasifica rechazo %s como %s sin texto del proveedor',
    async (code, state) => {
      await setup({ rejectCode: code as number });
      await expect(client.start()).rejects.toThrow('provider_error');
      expect(client.getStatus()).toMatchObject({
        state,
        lastError: { providerCode: code },
      });
      expect(logs.join('\n')).not.toContain('sentinel-secret');
    },
  );

  it('detecta pérdida silenciosa y libera heartbeat al detenerse', async () => {
    await setup({ replyHeartbeat: false });
    await client.start();
    const failed = firstValueFrom(
      client.status$.pipe(
        filter((status) => status.state === 'DEGRADED'),
        timeout(1000),
      ),
    );
    expect((await failed).lastError?.reason).toBe('heartbeat_timeout');
    await client.stop();
    const commands = mock.commands.length;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mock.commands.length).toBe(commands);
    expect(client.getStatus().state).toBe('STOPPED');
  });

  it('rechaza una suscripción ausente o de otro símbolo y conserva el fallo permanente', async () => {
    await setup();
    await client.start();
    const failed = firstValueFrom(
      client.status$.pipe(
        filter((status) => status.state === 'FAILED'),
        timeout(1000),
      ),
    );
    mock.send({
      event: 'subscribe-status',
      status: 'ok',
      success: [{ symbol: 'AAPL' }],
      fails: [],
    });
    expect((await failed).lastError?.reason).toBe('subscription_mismatch');
  });

  it('vence la espera de suscripción sin bloquear el backend', async () => {
    await setup(
      { replySubscription: false },
      { MARKET_DATA_SUBSCRIBE_TIMEOUT_MS: '30' },
    );
    await expect(client.start()).rejects.toThrow('subscribe_timeout');
  });
});
