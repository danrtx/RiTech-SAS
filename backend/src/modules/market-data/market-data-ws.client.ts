import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import { performance } from 'node:perf_hooks';
import { ClientOptions, RawData, WebSocket } from 'ws';
import { Subject } from 'rxjs';
import { MOCK_ALPACA_CREDENTIALS } from './alpaca.protocol';
import { MarketDataBatch, MarketDataMessage } from './market-data.protocol';
import { MARKET_DATA_CONFIG, MarketDataConfig } from './market-data.config';
import {
  ConnectionFailure,
  MarketDataConnectionError,
  MarketDataConnectionState,
  MarketDataConnectionStatus,
} from './market-data.connection';

export const MARKET_DATA_SOCKET_FACTORY = Symbol('MARKET_DATA_SOCKET_FACTORY');
export type MarketDataSocketFactory = (
  url: string,
  options: ClientOptions,
) => WebSocket;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

@Injectable()
export class MarketDataWsClient implements OnModuleDestroy {
  private readonly logger = new Logger(MarketDataWsClient.name);
  private state: MarketDataConnectionState = 'DISABLED';
  private lastError?: Readonly<ConnectionFailure>;
  private connection?: { socket: WebSocket; detach: () => void };
  private phaseTimer?: NodeJS.Timeout;
  private heartbeatTimer?: NodeJS.Timeout;
  private heartbeatDeadline?: NodeJS.Timeout;
  private pongTimer?: NodeJS.Timeout;
  private expectedPong?: string;
  private pingSequence = 0;
  private closing?: Promise<void>;
  private pending?: {
    promise: Promise<void>;
    resolve: () => void;
    reject: (error: Error) => void;
  };
  private readonly batches = new Subject<MarketDataBatch>();
  private readonly statuses = new Subject<MarketDataConnectionStatus>();
  readonly status$ = this.statuses.asObservable();
  /** Canal interno de datos crudos; no habilita decisiones ni escribe en Redis. */
  readonly data$ = this.batches.asObservable();

  constructor(
    @Inject(MARKET_DATA_CONFIG) private readonly config: MarketDataConfig,
    @Optional()
    @Inject(MARKET_DATA_SOCKET_FACTORY)
    private readonly socketFactory: MarketDataSocketFactory = (url, options) =>
      new WebSocket(url, options),
  ) {}

  getStatus(): MarketDataConnectionStatus {
    return Object.freeze({
      state: this.state,
      provider: this.config.provider,
      feed: this.config.feed,
      symbol: this.config.symbol,
      lastError: this.lastError,
    });
  }

  /** Resuelve al confirmar la suscripción; múltiples llamadas comparten la sesión. */
  start(): Promise<void> {
    if (!this.config.enabled) {
      this.transition('DISABLED');
      return Promise.resolve();
    }
    if (this.pending) return this.pending.promise;
    if (
      this.closing ||
      this.connection?.socket.readyState === WebSocket.CLOSING
    ) {
      return Promise.reject(
        new MarketDataConnectionError({ reason: 'closing', retryable: true }),
      );
    }
    if (this.state === 'LIVE') return Promise.resolve();
    // Una sesión terminada debe emitir close antes de admitir otra.
    if (this.connection) {
      return Promise.reject(
        new MarketDataConnectionError({ reason: 'closing', retryable: true }),
      );
    }
    let resolveStart!: () => void;
    let rejectStart!: (error: Error) => void;
    const promise = new Promise<void>((resolve, reject) => {
      resolveStart = resolve;
      rejectStart = reject;
    });
    this.pending = { promise, resolve: resolveStart, reject: rejectStart };
    this.lastError = undefined;
    this.transition('CONNECTING');
    try {
      const endpoint = new URL(this.config.wsUrl);
      if (this.config.provider === 'twelvedata') {
        const key =
          this.config.feed === 'mock'
            ? 'mock-twelve-api-key'
            : this.config.credentials?.apiKey;
        if (!key) {
          this.fail({ reason: 'credentials_missing', retryable: false });
          return promise;
        }
        // La URL autenticada existe solo para abrir el socket; nunca entra al estado ni logs.
        endpoint.searchParams.set('apikey', key);
      }
      const socket = this.socketFactory(endpoint.toString(), {
        followRedirects: false,
        perMessageDeflate: false,
        maxPayload: 1024 * 1024,
        headers: { 'Content-Type': 'application/json' },
      });
      const current = () => this.connection?.socket === socket;
      const open = () => {
        if (current()) this.authenticate();
      };
      const message = (data: RawData, binary: boolean) => {
        if (current()) this.receive(data, binary);
      };
      const error = () => {
        if (current())
          this.fail({ reason: 'transport_error', retryable: true });
      };
      const close = (code: number) => {
        if (!current()) return;
        this.fail({
          reason: 'connection_closed',
          retryable: ![1002, 1003, 1008, 1009].includes(code),
          closeCode: code,
        });
        this.clearPhaseTimer();
        this.clearHeartbeat();
        this.connection?.detach();
        this.connection = undefined;
      };
      const pong = (data: Buffer) => {
        if (current() && this.expectedPong === data.toString()) {
          clearTimeout(this.pongTimer);
          this.pongTimer = undefined;
          this.expectedPong = undefined;
          this.armHeartbeat();
        }
      };
      // Nunca leer ni registrar headers, cuerpo o mensaje de rechazo HTTP.
      const unexpectedResponse = (
        _request: unknown,
        httpResponse: import('node:http').IncomingMessage,
      ) => {
        if (!current()) return;
        httpResponse.resume();
        const status = httpResponse.statusCode;
        this.fail({
          reason: 'http_upgrade_rejected',
          retryable: status === 429 || (status !== undefined && status >= 500),
          httpStatus: status,
        });
      };
      this.connection = {
        socket,
        detach: () => {
          socket.off('open', open);
          socket.off('message', message);
          socket.off('error', error);
          socket.off('close', close);
          socket.off('unexpected-response', unexpectedResponse);
          socket.off('pong', pong);
        },
      };
      socket.on('open', open);
      socket.on('message', message);
      socket.on('error', error);
      socket.on('close', close);
      socket.on('unexpected-response', unexpectedResponse);
      socket.on('pong', pong);
      this.armPhaseTimer(this.config.connectTimeoutMs, 'connect_timeout');
    } catch {
      this.fail({ reason: 'transport_error', retryable: true });
    }
    return promise;
  }

  private authenticate(): void {
    this.transition('AUTHENTICATING');
    if (this.config.provider === 'twelvedata') {
      this.transition('SUBSCRIBING');
      this.armPhaseTimer(this.config.subscribeTimeoutMs, 'subscribe_timeout');
      this.send({
        action: 'subscribe',
        params: { symbols: this.config.symbol },
      });
      return;
    }
    this.armPhaseTimer(this.config.authTimeoutMs, 'auth_timeout');
    const credentials =
      this.config.feed === 'mock'
        ? MOCK_ALPACA_CREDENTIALS
        : this.config.credentials && {
            key: this.config.credentials.apiKey,
            secret: this.config.credentials.apiSecret,
          };
    if (!credentials) {
      this.fail({ reason: 'credentials_missing', retryable: false });
      return;
    }
    this.send({ action: 'auth', ...credentials });
  }

  private send(command: unknown): void {
    const socket = this.connection?.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      this.fail({ reason: 'send_failed', retryable: true });
      return;
    }
    try {
      socket.send(JSON.stringify(command), (error) => {
        if (error && this.connection?.socket === socket)
          this.fail({ reason: 'send_failed', retryable: true });
      });
    } catch {
      this.fail({ reason: 'send_failed', retryable: true });
    }
  }

  private receive(data: RawData, binary: boolean): void {
    if (!this.active()) return;
    const receivedAtMs = Date.now();
    const receivedAtMonotonicMs = performance.now();
    let frame: unknown;
    try {
      if (binary) throw new Error();
      const buffer = Array.isArray(data)
        ? Buffer.concat(data)
        : data instanceof ArrayBuffer
          ? Buffer.from(data)
          : data;
      frame = JSON.parse(buffer.toString('utf8'));
      if (this.config.provider === 'twelvedata') {
        if (!isRecord(frame)) throw new Error();
      } else if (!Array.isArray(frame) || frame.length === 0) throw new Error();
    } catch {
      this.invalidFrame();
      return;
    }
    if (this.config.provider === 'twelvedata') {
      this.receiveTwelveData(
        frame as Record<string, unknown>,
        receivedAtMs,
        receivedAtMonotonicMs,
      );
      return;
    }
    const messages: MarketDataMessage[] = [];
    for (const entry of frame as unknown[]) {
      if (!isRecord(entry) || typeof entry.T !== 'string') {
        this.invalidFrame();
        if (!this.active()) return;
        continue;
      }
      if (entry.T === 'success') this.success(entry);
      else if (entry.T === 'subscription') this.subscription(entry);
      else if (entry.T === 'error') {
        if (
          !Number.isSafeInteger(entry.code) ||
          typeof entry.code !== 'number'
        ) {
          this.fail({ reason: 'invalid_control', retryable: false });
        } else {
          this.fail({
            reason: 'provider_error',
            providerCode: entry.code,
            retryable: [404, 406, 407, 500].includes(entry.code),
          });
        }
      } else if (entry.T === 't' || entry.T === 'c' || entry.T === 'x') {
        if (this.state === 'LIVE')
          messages.push(Object.freeze({ ...entry }) as MarketDataMessage);
        else {
          this.fail({ reason: 'invalid_control', retryable: false });
        }
      } else this.logger.warn('market_data_unknown_message');
      if (!this.active()) return;
    }
    if (this.state === 'LIVE' && messages.length) {
      this.batches.next(
        Object.freeze({
          messages: Object.freeze(messages),
          receivedAtMs,
          receivedAtMonotonicMs,
        }),
      );
    }
  }

  private receiveTwelveData(
    frame: Record<string, unknown>,
    receivedAtMs: number,
    receivedAtMonotonicMs: number,
  ): void {
    if (frame.event === 'error' || frame.status === 'error') {
      const code =
        typeof frame.code === 'number' && Number.isSafeInteger(frame.code)
          ? frame.code
          : undefined;
      this.fail({
        reason: 'provider_error',
        providerCode: code,
        retryable:
          code === 429 || (code !== undefined && code >= 500 && code <= 599),
      });
      return;
    }
    if (frame.event === 'subscribe-status') {
      if (this.state !== 'SUBSCRIBING' && this.state !== 'LIVE') {
        this.fail({ reason: 'invalid_control', retryable: false });
        return;
      }
      const subscribed =
        Array.isArray(frame.success) &&
        frame.success.some(
          (entry) => isRecord(entry) && entry.symbol === this.config.symbol,
        );
      const rejected =
        Array.isArray(frame.fails) &&
        frame.fails.some(
          (entry) => isRecord(entry) && entry.symbol === this.config.symbol,
        );
      if (frame.status !== 'ok' || !subscribed || rejected) {
        this.fail({ reason: 'subscription_mismatch', retryable: false });
        return;
      }
      this.clearPhaseTimer();
      this.transition('LIVE');
      this.startTwelveHeartbeat();
      this.pending?.resolve();
      this.pending = undefined;
      return;
    }
    if (frame.event === 'heartbeat') {
      if (frame.status === 'ok') {
        if (this.heartbeatDeadline) clearTimeout(this.heartbeatDeadline);
        this.heartbeatDeadline = undefined;
      }
      return;
    }
    if (frame.event === 'price') {
      if (this.state !== 'LIVE') {
        this.fail({ reason: 'invalid_control', retryable: false });
        return;
      }
      this.batches.next(
        Object.freeze({
          messages: Object.freeze([
            Object.freeze({ ...frame, T: 'price' as const }),
          ]),
          receivedAtMs,
          receivedAtMonotonicMs,
        }),
      );
      return;
    }
    this.logger.warn('market_data_unknown_message');
  }

  private startTwelveHeartbeat(): void {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      if (this.state !== 'LIVE' || this.heartbeatDeadline) return;
      this.heartbeatDeadline = setTimeout(
        () => this.fail({ reason: 'heartbeat_timeout', retryable: true }),
        this.config.heartbeatTimeoutMs,
      );
      this.heartbeatDeadline.unref();
      this.send({ action: 'heartbeat' });
    }, this.config.heartbeatMs);
    this.heartbeatTimer.unref();
  }

  private invalidFrame(): void {
    if (this.state === 'LIVE') this.logger.warn('market_data_invalid_frame');
    else this.fail({ reason: 'invalid_frame', retryable: false });
  }

  private success(entry: Record<string, unknown>): void {
    if (entry.msg === 'connected') return;
    if (entry.msg !== 'authenticated' || this.state !== 'AUTHENTICATING') {
      this.fail({ reason: 'invalid_control', retryable: false });
      return;
    }
    this.transition('SUBSCRIBING');
    this.armPhaseTimer(this.config.subscribeTimeoutMs, 'subscribe_timeout');
    this.send({ action: 'subscribe', trades: [this.config.symbol] });
  }

  private subscription(entry: Record<string, unknown>): void {
    if (this.state !== 'SUBSCRIBING' && this.state !== 'LIVE') {
      this.fail({ reason: 'invalid_control', retryable: false });
      return;
    }
    if (
      !Array.isArray(entry.trades) ||
      entry.trades.some((s) => typeof s !== 'string') ||
      !entry.trades.includes(this.config.symbol)
    ) {
      this.fail({ reason: 'subscription_mismatch', retryable: false });
      return;
    }
    this.clearPhaseTimer();
    this.transition('LIVE');
    this.armHeartbeat();
    this.pending?.resolve();
    this.pending = undefined;
  }

  private active(): boolean {
    return ['CONNECTING', 'AUTHENTICATING', 'SUBSCRIBING', 'LIVE'].includes(
      this.state,
    );
  }

  private transition(state: MarketDataConnectionState): void {
    if (state === this.state) return;
    this.state = state;
    this.statuses.next(this.getStatus());
    // Lista explícita de campos permitidos: nunca serializar config o errores originales.
    this.logger.log(
      JSON.stringify({ event: 'market_data_state', ...this.getStatus() }),
    );
  }

  private fail(failure: ConnectionFailure): void {
    if (!this.active()) return;
    this.clearPhaseTimer();
    this.clearHeartbeat();
    const error = new MarketDataConnectionError(failure);
    this.lastError = error.failure;
    this.transition(failure.retryable ? 'DEGRADED' : 'FAILED');
    this.logger.warn(
      JSON.stringify({ event: 'market_data_failure', ...error.failure }),
    );
    this.pending?.reject(error);
    this.pending = undefined;
    const socket = this.connection?.socket;
    if (socket && socket.readyState !== WebSocket.CLOSED) socket.terminate();
  }

  private clearPhaseTimer(): void {
    if (this.phaseTimer) clearTimeout(this.phaseTimer);
    this.phaseTimer = undefined;
  }

  private clearHeartbeat(): void {
    clearTimeout(this.heartbeatTimer);
    clearTimeout(this.pongTimer);
    clearTimeout(this.heartbeatDeadline);
    this.heartbeatDeadline = undefined;
    this.heartbeatTimer = undefined;
    this.pongTimer = undefined;
    this.expectedPong = undefined;
  }

  private armHeartbeat(): void {
    if (this.state !== 'LIVE' || this.heartbeatTimer || this.pongTimer) return;
    this.heartbeatTimer = setTimeout(() => {
      this.heartbeatTimer = undefined;
      const socket = this.connection?.socket;
      if (this.state !== 'LIVE' || socket?.readyState !== WebSocket.OPEN)
        return;
      const token = String(++this.pingSequence);
      this.expectedPong = token;
      this.pongTimer = setTimeout(() => {
        if (this.connection?.socket === socket)
          this.fail({ reason: 'heartbeat_timeout', retryable: true });
      }, this.config.heartbeatTimeoutMs);
      this.pongTimer.unref();
      try {
        socket.ping(token, undefined, (error: Error | undefined) => {
          if (error && this.connection?.socket === socket)
            this.fail({ reason: 'send_failed', retryable: true });
        });
      } catch {
        this.fail({ reason: 'send_failed', retryable: true });
      }
    }, this.config.heartbeatMs);
    this.heartbeatTimer.unref();
  }

  private armPhaseTimer(
    timeoutMs: number,
    reason: 'connect_timeout' | 'auth_timeout' | 'subscribe_timeout',
  ): void {
    this.clearPhaseTimer();
    this.phaseTimer = setTimeout(
      () => this.fail({ reason, retryable: true }),
      timeoutMs,
    );
    this.phaseTimer.unref();
  }

  stop(): Promise<void> {
    if (this.closing) return this.closing;
    this.clearPhaseTimer();
    this.clearHeartbeat();
    this.pending?.reject(
      new MarketDataConnectionError({ reason: 'stopped', retryable: false }),
    );
    this.pending = undefined;
    this.transition('STOPPED');
    const socket = this.connection?.socket;
    if (!socket || socket.readyState === WebSocket.CLOSED)
      return Promise.resolve();
    const promise = new Promise<void>((resolve) => {
      const timer = setTimeout(
        () => socket.terminate(),
        this.config.closeTimeoutMs,
      );
      timer.unref();
      socket.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
      if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
      else if (socket.readyState === WebSocket.OPEN)
        socket.close(1000, 'shutdown');
    });
    this.closing = promise.finally(() => {
      this.closing = undefined;
    });
    return this.closing;
  }

  async onModuleDestroy(): Promise<void> {
    await this.stop();
    this.batches.complete();
    this.statuses.complete();
  }
}
