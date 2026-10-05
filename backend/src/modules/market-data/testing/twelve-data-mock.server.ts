import { AddressInfo } from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';

/** Harness local Twelve Data; nunca usa claves reales. */
export class TwelveDataMockServer {
  private server?: WebSocketServer;
  private readonly subscribed = new Set<WebSocket>();
  readonly commands: Record<string, unknown>[] = [];
  connections = 0;

  constructor(
    private readonly options: {
      port?: number;
      replyHeartbeat?: boolean;
      replySubscription?: boolean;
      rejectCode?: number;
    } = {},
  ) {}

  async start(): Promise<string> {
    const server = new WebSocketServer({
      host: '127.0.0.1',
      port: this.options.port ?? 0,
      path: '/v2/mock',
      maxPayload: 65536,
      perMessageDeflate: false,
    });
    this.server = server;
    server.on('error', () => undefined);
    server.on('connection', (socket, request) => {
      this.connections++;
      socket.on('error', () => undefined);
      socket.on('close', () => this.subscribed.delete(socket));
      const key = new URL(
        request.url ?? '/',
        'http://localhost',
      ).searchParams.get('apikey');
      if (key !== 'mock-twelve-api-key') {
        socket.send(
          JSON.stringify({
            event: 'error',
            code: 401,
            status: 'error',
            message: 'invalid key',
          }),
        );
        socket.close(1008);
        return;
      }
      socket.on('message', (raw) => {
        let command: Record<string, unknown>;
        try {
          command = JSON.parse(raw.toString());
        } catch {
          return;
        }
        this.commands.push(command);
        if (command.action === 'subscribe') {
          if (this.options.replySubscription === false) return;
          const params = command.params as { symbols?: unknown } | undefined;
          if (this.options.rejectCode || params?.symbols !== 'QQQ') {
            socket.send(
              JSON.stringify({
                event: 'subscribe-status',
                status: 'error',
                code: this.options.rejectCode ?? 400,
                success: [],
                fails: [{ symbol: 'QQQ', message: 'sentinel-secret' }],
              }),
            );
          } else {
            this.subscribed.add(socket);
            socket.send(
              JSON.stringify({
                event: 'subscribe-status',
                status: 'ok',
                success: [{ symbol: 'QQQ', exchange: 'NASDAQ', type: 'ETF' }],
                fails: [],
              }),
            );
          }
        } else if (
          command.action === 'heartbeat' &&
          this.options.replyHeartbeat !== false
        ) {
          socket.send(JSON.stringify({ event: 'heartbeat', status: 'ok' }));
        }
      });
    });
    await new Promise<void>((resolve, reject) => {
      const failed = (error: Error) => reject(error);
      server.once('error', failed);
      server.once('listening', () => {
        server.off('error', failed);
        resolve();
      });
    });
    return `ws://127.0.0.1:${(server.address() as AddressInfo).port}/v2/mock`;
  }

  publish(price: number, timeMs = Date.now()): void {
    this.send({
      event: 'price',
      symbol: 'QQQ',
      currency: 'USD',
      exchange: 'NASDAQ',
      type: 'ETF',
      timestamp: Math.floor(timeMs / 1000),
      price,
    });
  }

  send(frame: unknown): void {
    for (const socket of this.subscribed) {
      if (socket.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify(frame));
    }
  }

  disconnectClients(): void {
    for (const socket of this.subscribed)
      socket.close(1001, 'controlled mock disconnect');
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (!server) return;
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    this.subscribed.clear();
    this.server = undefined;
  }
}
