import { AddressInfo } from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';
import { AlpacaTradeFixture, MOCK_ALPACA_CREDENTIALS } from './alpaca.fixtures';

interface Session {
  authenticated: boolean;
  trades: Set<string>;
  authTimer: NodeJS.Timeout;
}

export interface AlpacaMockOptions {
  port?: number;
  symbol?: 'QQQ' | 'FAKEPACA';
  authTimeoutMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Harness local del protocolo; no importa ni usa claves reales o servicios Nest. */
export class AlpacaMockServer {
  private server?: WebSocketServer;
  private readonly sessions = new Map<WebSocket, Session>();
  private readonly port: number;
  private readonly symbol: string;
  private readonly authTimeoutMs: number;

  constructor(options: AlpacaMockOptions = {}) {
    this.port = options.port ?? 0;
    this.symbol = options.symbol ?? 'QQQ';
    this.authTimeoutMs = options.authTimeoutMs ?? 10000;
    if (!Number.isInteger(this.port) || this.port < 0 || this.port > 65535) {
      throw new Error('Puerto del mock inválido');
    }
    if (!Number.isSafeInteger(this.authTimeoutMs) || this.authTimeoutMs <= 0) {
      throw new Error('Timeout de autenticación del mock inválido');
    }
  }

  async start(): Promise<string> {
    if (this.server) throw new Error('El mock ya está iniciado');
    const server = new WebSocketServer({
      host: '127.0.0.1',
      port: this.port,
      path: '/v2/mock',
      maxPayload: 64 * 1024,
      perMessageDeflate: false,
    });
    this.server = server;
    server.on('connection', (socket) => this.connect(socket));
    // Evita errores no manejados durante el cierre; start rechaza errores de bind.
    server.on('error', () => undefined);
    try {
      await new Promise<void>((resolve, reject) => {
        const ready = () => {
          server.off('error', failed);
          resolve();
        };
        const failed = (error: Error) => {
          server.off('listening', ready);
          reject(error);
        };
        server.once('listening', ready);
        server.once('error', failed);
      });
    } catch (error) {
      this.server = undefined;
      throw error;
    }
    return `ws://127.0.0.1:${(server.address() as AddressInfo).port}/v2/mock`;
  }

  private send(socket: WebSocket, payload: unknown[]): void {
    if (socket.readyState === WebSocket.OPEN)
      socket.send(JSON.stringify(payload));
  }

  private error(
    socket: WebSocket,
    code: number,
    msg: string,
    close = false,
  ): void {
    this.send(socket, [{ T: 'error', code, msg }]);
    if (close) socket.close(1008, 'mock protocol error');
  }

  private connect(socket: WebSocket): void {
    socket.on('error', () => undefined);
    if (this.sessions.size > 0) {
      this.error(socket, 406, 'connection limit exceeded', true);
      return;
    }
    const authTimer = setTimeout(() => {
      this.error(socket, 404, 'auth timeout', true);
    }, this.authTimeoutMs);
    authTimer.unref();
    const session: Session = {
      authenticated: false,
      trades: new Set(),
      authTimer,
    };
    this.sessions.set(socket, session);
    socket.once('close', () => {
      clearTimeout(authTimer);
      this.sessions.delete(socket);
    });
    socket.on('message', (data, binary) => {
      if (binary) {
        this.error(socket, 400, 'invalid syntax');
        return;
      }
      let command: unknown;
      try {
        command = JSON.parse(data.toString());
      } catch {
        this.error(socket, 400, 'invalid syntax');
        return;
      }
      this.command(socket, session, command);
    });
    this.send(socket, [{ T: 'success', msg: 'connected' }]);
  }

  private command(socket: WebSocket, session: Session, command: unknown): void {
    if (!isRecord(command)) {
      this.error(socket, 400, 'invalid syntax');
      return;
    }
    if (command.action === 'auth') {
      if (session.authenticated) {
        this.error(socket, 403, 'already authenticated');
        return;
      }
      if (
        command.key !== MOCK_ALPACA_CREDENTIALS.key ||
        command.secret !== MOCK_ALPACA_CREDENTIALS.secret
      ) {
        this.error(socket, 402, 'auth failed', true);
        return;
      }
      session.authenticated = true;
      clearTimeout(session.authTimer);
      this.send(socket, [{ T: 'success', msg: 'authenticated' }]);
      return;
    }
    if (!session.authenticated) {
      this.error(socket, 401, 'not authenticated');
      return;
    }
    if (command.action !== 'subscribe' && command.action !== 'unsubscribe') {
      this.error(socket, 400, 'invalid action');
      return;
    }
    if (
      Object.keys(command).some((key) => key !== 'action' && key !== 'trades')
    ) {
      this.error(socket, 410, 'invalid subscribe action for this feed');
      return;
    }
    if (
      !Array.isArray(command.trades) ||
      command.trades.some((s) => typeof s !== 'string')
    ) {
      this.error(socket, 400, 'invalid syntax');
      return;
    }
    if (command.trades.some((symbol) => symbol !== this.symbol)) {
      this.error(socket, 400, 'unsupported mock symbol');
      return;
    }
    for (const symbol of command.trades) {
      if (command.action === 'subscribe') session.trades.add(symbol);
      else session.trades.delete(symbol);
    }
    this.send(socket, [
      { T: 'subscription', trades: [...session.trades], quotes: [], bars: [] },
    ]);
  }

  publish(trades: readonly AlpacaTradeFixture[]): number {
    let deliveries = 0;
    for (const [socket, session] of this.sessions) {
      const batch = trades.filter((trade) => session.trades.has(trade.S));
      if (
        session.authenticated &&
        socket.readyState === WebSocket.OPEN &&
        batch.length > 0
      ) {
        this.send(socket, batch);
        deliveries++;
      }
    }
    return deliveries;
  }

  /** Inyección explícita de frames inválidos para las pruebas del adaptador. */
  sendRawFrame(frame: string): void {
    for (const [socket, session] of this.sessions) {
      if (
        session.authenticated &&
        session.trades.size &&
        socket.readyState === WebSocket.OPEN
      ) {
        socket.send(frame);
      }
    }
  }

  disconnectClients(): void {
    for (const socket of this.sessions.keys())
      socket.close(1001, 'controlled mock disconnect');
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (!server) return;
    for (const session of this.sessions.values())
      clearTimeout(session.authTimer);
    // Incluye sockets rechazados por el límite de conexión.
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    this.sessions.clear();
    this.server = undefined;
  }
}
