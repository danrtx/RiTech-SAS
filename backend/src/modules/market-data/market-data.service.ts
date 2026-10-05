import {
  Injectable,
  Inject,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Subscription } from 'rxjs';
import { performance } from 'node:perf_hooks';
import { MarketDataWsClient } from './market-data-ws.client';
import { MarketDataProcessor } from './market-data.processor';
import { MARKET_DATA_CONFIG, MarketDataConfig } from './market-data.config';

@Injectable()
export class MarketDataService
  implements OnApplicationBootstrap, OnModuleInit, OnModuleDestroy
{
  private readonly subscriptions = new Subscription();
  private readonly logger = new Logger(MarketDataService.name);
  private reconnectTimer?: NodeJS.Timeout;
  private stopping = false;
  private started = false;
  private reconnectAttempt = 0;
  private reconnecting = false;
  private reconnects = 0;
  private reconnectAttempts = 0;
  private degradedAtMonotonicMs?: number;
  private lastRecoveryDurationMs: number | null = null;
  constructor(
    private readonly client: MarketDataWsClient,
    private readonly processor: MarketDataProcessor,
    @Inject(MARKET_DATA_CONFIG) private readonly config: MarketDataConfig,
  ) {}

  onModuleInit(): void {
    this.subscriptions.add(
      this.client.status$.subscribe((status) => {
        this.processor.setLive(status.state === 'LIVE');
        if (status.state === 'LIVE') {
          if (this.degradedAtMonotonicMs !== undefined) {
            this.reconnects++;
            this.lastRecoveryDurationMs =
              performance.now() - this.degradedAtMonotonicMs;
            this.degradedAtMonotonicMs = undefined;
            this.logger.log(
              JSON.stringify({
                event: 'market_data_reconnected',
                durationMs: this.lastRecoveryDurationMs,
              }),
            );
          }
          this.reconnectAttempt = 0;
          this.clearReconnectTimer();
        } else if (status.state === 'DEGRADED') {
          this.degradedAtMonotonicMs ??= performance.now();
          this.scheduleReconnect();
        } else if (status.state === 'FAILED' || status.state === 'STOPPED')
          this.clearReconnectTimer();
      }),
    );
    this.subscriptions.add(
      this.client.data$.subscribe((batch) => this.processor.accept(batch)),
    );
  }

  async onApplicationBootstrap(): Promise<void> {
    this.started = true;
    // Feed opcional: un fallo deja estado FAILED/DEGRADED y no impide servir HTTP.
    // El cliente ya registra el motivo seguro; no propagar stacks al bootstrap.
    await this.client.start().catch(() => this.scheduleReconnect());
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }

  private scheduleReconnect(): void {
    if (
      !this.started ||
      this.stopping ||
      !this.config.enabled ||
      this.reconnectTimer ||
      this.reconnecting
    )
      return;
    if (this.client.getStatus().state !== 'DEGRADED') return;
    const delayMs = Math.min(
      this.config.reconnectMaxMs,
      this.config.reconnectBaseMs * 2 ** Math.min(this.reconnectAttempt++, 20),
    );
    this.logger.log(
      JSON.stringify({ event: 'market_data_reconnect_scheduled', delayMs }),
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.reconnecting = true;
      this.reconnectAttempts++;
      void this.client
        .start()
        .catch(() => undefined)
        .finally(() => {
          this.reconnecting = false;
          this.scheduleReconnect();
        });
    }, delayMs);
    this.reconnectTimer.unref();
  }

  getStatus() {
    return {
      reconnects: this.reconnects,
      reconnectAttempts: this.reconnectAttempts,
      lastRecoveryDurationMs: this.lastRecoveryDurationMs,
      reconnectScheduled: !!this.reconnectTimer,
      reconnecting: this.reconnecting,
    };
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    this.clearReconnectTimer();
    this.subscriptions.unsubscribe();
    this.processor.setLive(false);
    this.processor.invalidate('shutdown');
    await this.processor.whenIdle();
  }
}
