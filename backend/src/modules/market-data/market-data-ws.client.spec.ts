import { Logger } from '@nestjs/common';
import { once } from 'node:events';
import { AddressInfo } from 'node:net';
import { createServer, Server } from 'node:http';
import { firstValueFrom, timeout } from 'rxjs';
import { WebSocket, WebSocketServer } from 'ws';
import { parseMarketDataConfig } from './market-data.config';
import {
  MarketDataWsClient,
  MarketDataSocketFactory,
} from './market-data-ws.client';
import { AlpacaMockServer } from './testing/alpaca-mock.server';
import {
  createTradeBatch,
  MOCK_ALPACA_CREDENTIALS,
} from './testing/alpaca.fixtures';

describe('Cliente WebSocket de market data', () => {
  let mock: AlpacaMockServer;
  let url: string;
  let clients: MarketDataWsClient[];
  let scripted: WebSocketServer[];
  let httpServers: Server[];
  let logs: string[];

  beforeEach(async () => {
    clients = [];
    scripted = [];
    httpServers = [];
    logs = [];
    jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation((message: unknown) => {
        logs.push(String(message));
      });
    jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation((message: unknown) => {
        logs.push(String(message));
      });
    mock = new AlpacaMockServer();
    url = await mock.start();
  });
  afterEach(async () => {
    for (const client of clients) await client.onModuleDestroy();
    await mock.stop();
    for (const server of scripted) {
      for (const socket of server.clients) socket.terminate();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    for (const server of httpServers) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    jest.restoreAllMocks();
  });

  function client(
    env: Record<string, string> = {},
    factory?: MarketDataSocketFactory,
  ): MarketDataWsClient {
    const instance = new MarketDataWsClient(
      parseMarketDataConfig({
        MARKET_DATA_ENABLED: 'true',
        MARKET_DATA_FEED: 'mock',
        MARKET_DATA_WS_URL: url,
        ...env,
      }),
      factory,
    );
    clients.push(instance);
    return instance;
  }

  async function script(
    handler: (socket: WebSocket, command: Record<string, unknown>) => void,
  ): Promise<string> {
    const server = new WebSocketServer({
      port: 0,
      host: '127.0.0.1',
      path: '/v2/mock',
    });
    scripted.push(server);
    server.on('connection', (socket) => {
      socket.on('error', () => undefined);
      socket.on('message', (data) =>
        handler(socket, JSON.parse(data.toString())),
      );
      socket.send(JSON.stringify([{ T: 'success', msg: 'connected' }]));
    });
    await once(server, 'listening');
    return `ws://127.0.0.1:${(server.address() as AddressInfo).port}/v2/mock`;
  }

  function reply(socket: WebSocket, entries: unknown[]): void {
    socket.send(JSON.stringify(entries));
  }

  it('no abre ningún socket cuando está deshabilitado', async () => {
    const factory = jest.fn();
    const instance = client({ MARKET_DATA_ENABLED: 'false' }, factory);
    await instance.start();
    expect(factory).not.toHaveBeenCalled();
    expect(instance.getStatus().state).toBe('DISABLED');
  });

  it('autentica y suscribe una sola vez ante llamadas simultáneas', async () => {
    const factory = jest.fn(
      (endpoint, options) => new WebSocket(endpoint, options),
    );
    const instance = client({}, factory);
    const start = instance.start();
    expect(instance.start()).toBe(start);
    await start;
    await instance.start();
    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory.mock.calls[0][1]).toMatchObject({
      followRedirects: false,
      headers: { 'Content-Type': 'application/json' },
    });
    expect(instance.getStatus()).toMatchObject({
      state: 'LIVE',
      feed: 'mock',
      symbol: 'QQQ',
      lastError: undefined,
    });
    expect(
      logs
        .filter((line) => line.includes('market_data_state'))
        .map((line) => JSON.parse(line).state),
    ).toEqual(['CONNECTING', 'AUTHENTICATING', 'SUBSCRIBING', 'LIVE']);
  });

  it('expone el lote crudo completo con sus timestamps sin mezclar controles', async () => {
    const instance = client();
    await instance.start();
    const batch = createTradeBatch();
    const received = firstValueFrom(instance.data$.pipe(timeout(2000)));
    mock.publish(batch);
    const result = await received;
    expect(result.messages).toEqual(batch);
    expect(result.receivedAtMs).toBeGreaterThan(0);
    expect(Number.isFinite(result.receivedAtMonotonicMs)).toBe(true);
    expect(logs.join('\n')).not.toContain(batch[0].t);
    expect(logs.join('\n')).not.toContain(MOCK_ALPACA_CREDENTIALS.secret);
  });

  it('usa el endpoint test y FAKEPACA con credenciales externas mediante la misma implementación', async () => {
    await mock.stop();
    mock = new AlpacaMockServer({ symbol: 'FAKEPACA' });
    url = await mock.start();
    const factory = jest.fn(
      (_endpoint, options) => new WebSocket(url, options),
    );
    const instance = client(
      {
        MARKET_DATA_FEED: 'test',
        MARKET_DATA_SYMBOL: 'FAKEPACA',
        MARKET_DATA_WS_URL: 'wss://stream.data.alpaca.markets/v2/test',
        ALPACA_API_KEY: MOCK_ALPACA_CREDENTIALS.key,
        ALPACA_API_SECRET: MOCK_ALPACA_CREDENTIALS.secret,
      },
      factory,
    );
    await instance.start();
    expect(factory.mock.calls[0][0]).toBe(
      'wss://stream.data.alpaca.markets/v2/test',
    );
    expect(instance.getStatus()).toMatchObject({
      state: 'LIVE',
      feed: 'test',
      symbol: 'FAKEPACA',
    });
    const received = firstValueFrom(instance.data$.pipe(timeout(2000)));
    mock.publish(
      createTradeBatch().map((trade) => ({ ...trade, S: 'FAKEPACA' })),
    );
    expect((await received).messages).toHaveLength(2);
  });

  it('rechaza credenciales externas inválidas y conserva el error permanente', async () => {
    const instance = client(
      {
        MARKET_DATA_FEED: 'iex',
        MARKET_DATA_WS_URL: 'wss://stream.data.alpaca.markets/v2/iex',
        ALPACA_API_KEY: 'sentinel-key',
        ALPACA_API_SECRET: 'sentinel-secret',
      },
      (_endpoint, options) => new WebSocket(url, options),
    );
    await expect(instance.start()).rejects.toMatchObject({
      message: 'market_data_provider_error',
      failure: { providerCode: 402, retryable: false },
    });
    expect(instance.getStatus().state).toBe('FAILED');
    const output = JSON.stringify(instance.getStatus()) + logs.join('\n');
    expect(output).not.toContain('sentinel');
    await instance.stop();
  });

  it.each([
    [400, false],
    [401, false],
    [402, false],
    [403, false],
    [404, true],
    [405, false],
    [406, true],
    [407, true],
    [409, false],
    [410, false],
    [500, true],
    [599, false],
  ])(
    'clasifica el error del proveedor %s sin exponer su texto',
    async (code, retryable) => {
      const endpoint = await script((socket) =>
        reply(socket, [{ T: 'error', code, msg: 'sentinel-secret' }]),
      );
      const instance = client({ MARKET_DATA_WS_URL: endpoint });
      await expect(instance.start()).rejects.toMatchObject({
        failure: { reason: 'provider_error', providerCode: code, retryable },
      });
      expect(instance.getStatus().state).toBe(
        retryable ? 'DEGRADED' : 'FAILED',
      );
      expect(
        JSON.stringify(instance.getStatus()) + logs.join('\n'),
      ).not.toContain('sentinel-secret');
    },
  );

  it('un segundo cliente recibe 406 sin iniciar reintentos automáticos', async () => {
    await client().start();
    const second = client();
    await expect(second.start()).rejects.toMatchObject({
      failure: { providerCode: 406, retryable: true },
    });
    expect(second.getStatus().state).toBe('DEGRADED');
  });

  it.each([
    { trades: [] },
    { trades: ['NDX'] },
    { trades: ['*'] },
    { trades: [123] },
  ])(
    'rechaza una confirmación de suscripción incorrecta: %j',
    async ({ trades }) => {
      const endpoint = await script((socket, command) =>
        reply(
          socket,
          command.action === 'auth'
            ? [{ T: 'success', msg: 'authenticated' }]
            : [{ T: 'subscription', trades }],
        ),
      );
      const instance = client({ MARKET_DATA_WS_URL: endpoint });
      await expect(instance.start()).rejects.toMatchObject({
        failure: { reason: 'subscription_mismatch', retryable: false },
      });
      expect(instance.getStatus().state).toBe('FAILED');
    },
  );

  it('no envía subscribe antes de authenticated y vence la espera de autenticación', async () => {
    const commands: unknown[] = [];
    const endpoint = await script((_socket, command) => {
      commands.push(command.action);
    });
    const instance = client({
      MARKET_DATA_WS_URL: endpoint,
      MARKET_DATA_AUTH_TIMEOUT_MS: '100',
    });
    await expect(instance.start()).rejects.toMatchObject({
      failure: { reason: 'auth_timeout', retryable: true },
    });
    expect(commands).toEqual(['auth']);
  });

  it('vence la espera de suscripción sin quedarse en SUBSCRIBING', async () => {
    const endpoint = await script((socket, command) => {
      if (command.action === 'auth')
        reply(socket, [{ T: 'success', msg: 'authenticated' }]);
    });
    const instance = client({
      MARKET_DATA_WS_URL: endpoint,
      MARKET_DATA_SUBSCRIBE_TIMEOUT_MS: '100',
    });
    await expect(instance.start()).rejects.toMatchObject({
      failure: { reason: 'subscribe_timeout', retryable: true },
    });
    expect(instance.getStatus().state).toBe('DEGRADED');
  });

  it('vence un handshake HTTP que nunca responde y cancela el socket', async () => {
    const server = createServer();
    httpServers.push(server);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const endpoint = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/v2/mock`;
    const instance = client({
      MARKET_DATA_WS_URL: endpoint,
      MARKET_DATA_CONNECT_TIMEOUT_MS: '100',
    });
    await expect(instance.start()).rejects.toMatchObject({
      failure: { reason: 'connect_timeout', retryable: true },
    });
    await instance.stop();
  });

  it.each([401, 429, 503])(
    'sanitiza el rechazo HTTP %s del upgrade',
    async (status) => {
      const server = createServer();
      httpServers.push(server);
      server.on('upgrade', (_request, socket) => {
        socket.end(
          `HTTP/1.1 ${status} sentinel-secret\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`,
        );
      });
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const endpoint = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/v2/mock`;
      const instance = client({ MARKET_DATA_WS_URL: endpoint });
      await expect(instance.start()).rejects.toMatchObject({
        failure: {
          reason: 'http_upgrade_rejected',
          httpStatus: status,
          retryable: status !== 401,
        },
      });
      expect(logs.join('\n')).not.toContain('sentinel-secret');
    },
  );

  it('descarta frames inválidos en LIVE y sigue recibiendo operaciones', async () => {
    const instance = client();
    await instance.start();
    const received = firstValueFrom(instance.data$.pipe(timeout(2000)));
    mock.sendRawFrame('sentinel-secret');
    mock.sendRawFrame(JSON.stringify({ T: 't' }));
    mock.sendRawFrame(JSON.stringify([null, ...createTradeBatch()]));
    expect((await received).messages).toEqual(createTradeBatch());
    expect(instance.getStatus().state).toBe('LIVE');
    expect(logs.join('\n')).not.toContain('sentinel-secret');
  });

  it('separa correcciones y cancelaciones de los mensajes de control', async () => {
    const instance = client();
    await instance.start();
    const received = firstValueFrom(instance.data$.pipe(timeout(2000)));
    const events = [
      { T: 'c', S: 'QQQ', oi: 1 },
      { T: 'x', S: 'QQQ', i: 2 },
    ];
    mock.sendRawFrame(
      JSON.stringify([{ T: 'subscription', trades: ['QQQ'] }, ...events]),
    );
    expect((await received).messages).toEqual(events);
  });

  it('mantiene el estado del error permanente al cerrar y no publica datos después', async () => {
    let socket!: WebSocket;
    const instance = client({}, (endpoint, options) => {
      socket = new WebSocket(endpoint, options);
      return socket;
    });
    await instance.start();
    const batches = jest.fn();
    instance.data$.subscribe(batches);
    const closed = once(socket, 'close');
    mock.sendRawFrame(
      JSON.stringify([
        { T: 'error', code: 409, msg: 'sentinel-secret' },
        ...createTradeBatch(),
      ]),
    );
    await closed;
    expect(instance.getStatus()).toMatchObject({
      state: 'FAILED',
      lastError: { providerCode: 409 },
    });
    expect(batches).not.toHaveBeenCalled();
  });

  it('cierra limpiamente y permite un inicio manual posterior', async () => {
    const instance = client();
    await instance.start();
    await instance.stop();
    await instance.stop();
    expect(instance.getStatus().state).toBe('STOPPED');
    await instance.start();
    expect(instance.getStatus().state).toBe('LIVE');
  });

  it('sale de LIVE ante un corte inesperado sin reconectar automáticamente', async () => {
    let socket!: WebSocket;
    const factory = jest.fn((endpoint, options) => {
      socket = new WebSocket(endpoint, options);
      return socket;
    });
    const instance = client({}, factory);
    await instance.start();
    const closed = once(socket, 'close');
    mock.disconnectClients();
    await closed;
    expect(instance.getStatus()).toMatchObject({
      state: 'DEGRADED',
      lastError: {
        reason: 'connection_closed',
        retryable: true,
        closeCode: 1001,
      },
    });
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('fuerza el cierre si el servidor deja de responder al handshake de salida', async () => {
    const endpoint = await script((socket, command) => {
      if (command.action === 'auth')
        reply(socket, [{ T: 'success', msg: 'authenticated' }]);
      else {
        reply(socket, [{ T: 'subscription', trades: ['QQQ'] }]);
        socket.pause();
      }
    });
    let socket!: WebSocket;
    const instance = client(
      { MARKET_DATA_WS_URL: endpoint, MARKET_DATA_CLOSE_TIMEOUT_MS: '50' },
      (url, options) => {
        socket = new WebSocket(url, options);
        return socket;
      },
    );
    await instance.start();
    const closed = once(socket, 'close');
    await instance.stop();
    expect((await closed)[0]).toBe(1006);
    expect(socket.readyState).toBe(WebSocket.CLOSED);
    expect(instance.getStatus().state).toBe('STOPPED');
  });

  it('cancela un arranque pendiente sin dejar callbacks o temporizadores', async () => {
    const factory = jest.fn(
      (endpoint, options) => new WebSocket(endpoint, options),
    );
    const instance = client({}, factory);
    const start = expect(instance.start()).rejects.toMatchObject({
      failure: { reason: 'stopped' },
    });
    const stopped = instance.stop();
    expect(instance.stop()).toBe(stopped);
    await stopped;
    await start;
    const socket = factory.mock.results[0].value;
    expect(socket.readyState).toBe(WebSocket.CLOSED);
    expect(socket.listenerCount('message')).toBe(0);
    expect(socket.listenerCount('error')).toBe(0);
    expect(instance.getStatus().state).toBe('STOPPED');
  });

  it('sanitiza errores síncronos del transporte sin filtrar la excepción original', async () => {
    const instance = client({}, () => {
      throw new Error('sentinel-secret');
    });
    await expect(instance.start()).rejects.toMatchObject({
      message: 'market_data_transport_error',
    });
    expect(logs.join('\n')).not.toContain('sentinel-secret');
    expect(instance.getStatus().state).toBe('DEGRADED');
  });
});
