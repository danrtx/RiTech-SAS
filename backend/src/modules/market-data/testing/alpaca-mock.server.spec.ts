import { once } from 'node:events';
import { WebSocket } from 'ws';
import { AlpacaMockServer } from './alpaca-mock.server';
import {
  createInvalidFrames,
  createTradeBatch,
  MOCK_ALPACA_CREDENTIALS,
} from './alpaca.fixtures';

function nextFrame(socket: WebSocket): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      socket.off('message', message);
      socket.off('error', failed);
      socket.off('close', closed);
    };
    const message = (data: Buffer) => {
      cleanup();
      try {
        resolve(JSON.parse(data.toString()));
      } catch (error) {
        reject(error);
      }
    };
    const failed = (error: Error) => {
      cleanup();
      reject(error);
    };
    const closed = () => failed(new Error('Socket cerrado antes del frame'));
    const timer = setTimeout(
      () => failed(new Error('Timeout esperando frame')),
      2000,
    );
    socket.once('message', message);
    socket.once('error', failed);
    socket.once('close', closed);
  });
}

async function request(
  socket: WebSocket,
  command: unknown,
): Promise<unknown[]> {
  const reply = nextFrame(socket);
  socket.send(typeof command === 'string' ? command : JSON.stringify(command));
  return reply;
}

describe('Mock Alpaca por WebSocket real en loopback', () => {
  let server: AlpacaMockServer;
  let url: string;
  let clients: WebSocket[];

  beforeEach(async () => {
    clients = [];
    server = new AlpacaMockServer();
    url = await server.start();
  });
  afterEach(async () => {
    for (const client of clients) client.terminate();
    await server.stop();
  });

  async function connect(): Promise<WebSocket> {
    const socket = new WebSocket(url);
    clients.push(socket);
    socket.on('error', () => undefined);
    expect(await nextFrame(socket)).toEqual([
      { T: 'success', msg: 'connected' },
    ]);
    return socket;
  }

  async function authenticated(): Promise<WebSocket> {
    const socket = await connect();
    expect(
      await request(socket, { action: 'auth', ...MOCK_ALPACA_CREDENTIALS }),
    ).toEqual([{ T: 'success', msg: 'authenticated' }]);
    return socket;
  }

  it('exige autenticación y suscripción, y conserva lotes, IDs y nanosegundos', async () => {
    const socket = await connect();
    const batch = createTradeBatch();
    expect(server.publish(batch)).toBe(0);
    expect(
      await request(socket, { action: 'subscribe', trades: ['QQQ'] }),
    ).toEqual([{ T: 'error', code: 401, msg: 'not authenticated' }]);
    await request(socket, { action: 'auth', ...MOCK_ALPACA_CREDENTIALS });
    expect(server.publish(batch)).toBe(0);
    expect(
      await request(socket, { action: 'subscribe', trades: ['QQQ'] }),
    ).toEqual([{ T: 'subscription', trades: ['QQQ'], quotes: [], bars: [] }]);
    const received = nextFrame(socket);
    expect(server.publish(batch)).toBe(1);
    expect(await received).toEqual(batch);
    await request(socket, { action: 'unsubscribe', trades: ['QQQ'] });
    expect(server.publish(batch)).toBe(0);
  });

  it('responde errores seguros a JSON inválido, símbolos ajenos y canales no admitidos', async () => {
    const socket = await authenticated();
    expect(await request(socket, '[{')).toEqual([
      { T: 'error', code: 400, msg: 'invalid syntax' },
    ]);
    expect(
      await request(socket, { action: 'subscribe', trades: ['NDX'] }),
    ).toEqual([{ T: 'error', code: 400, msg: 'unsupported mock symbol' }]);
    expect(
      await request(socket, { action: 'subscribe', quotes: ['QQQ'] }),
    ).toEqual([
      { T: 'error', code: 410, msg: 'invalid subscribe action for this feed' },
    ]);
    const first = await request(socket, {
      action: 'subscribe',
      trades: ['QQQ'],
    });
    expect(
      await request(socket, { action: 'subscribe', trades: ['QQQ'] }),
    ).toEqual(first);
  });

  it('rechaza claves inválidas sin reflejarlas en la respuesta y cierra', async () => {
    const socket = await connect();
    const closed = once(socket, 'close');
    const reply = await request(socket, {
      action: 'auth',
      key: 'sentinel-key',
      secret: 'sentinel-secret',
    });
    expect(reply).toEqual([{ T: 'error', code: 402, msg: 'auth failed' }]);
    expect(JSON.stringify(reply)).not.toContain('sentinel');
    expect((await closed)[0]).toBe(1008);
  });

  it('limita conexiones simultáneas a una', async () => {
    await connect();
    const second = new WebSocket(url);
    clients.push(second);
    second.on('error', () => undefined);
    const closed = once(second, 'close');
    expect(await nextFrame(second)).toEqual([
      { T: 'error', code: 406, msg: 'connection limit exceeded' },
    ]);
    await closed;
  });

  it('permite inyectar frames inválidos para pruebas de la etapa 3', async () => {
    const socket = await authenticated();
    await request(socket, { action: 'subscribe', trades: ['QQQ'] });
    const received = once(socket, 'message');
    server.sendRawFrame(createInvalidFrames().malformedJson);
    expect((await received)[0].toString()).toBe('[{');
  });

  it('responde pong y permite un corte controlado y una sesión nueva', async () => {
    const socket = await authenticated();
    const pong = once(socket, 'pong');
    socket.ping('probe');
    expect((await pong)[0].toString()).toBe('probe');
    const closed = once(socket, 'close');
    server.disconnectClients();
    expect((await closed)[0]).toBe(1001);
    await authenticated();
  });

  it('aplica timeout de autenticación y libera recursos al detenerse', async () => {
    await server.stop();
    server = new AlpacaMockServer({ authTimeoutMs: 500 });
    url = await server.start();
    const socket = await connect();
    const closed = once(socket, 'close');
    expect(await nextFrame(socket)).toEqual([
      { T: 'error', code: 404, msg: 'auth timeout' },
    ]);
    await closed;
    await server.stop();
    await server.stop();
    // El mismo puerto vuelve a estar disponible, sin listeners o sockets pendientes.
    server = new AlpacaMockServer({ port: Number(new URL(url).port) });
    url = await server.start();
    await connect();
  });
});
