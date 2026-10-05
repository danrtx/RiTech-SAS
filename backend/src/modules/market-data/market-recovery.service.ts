import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { MARKET_DATA_CONFIG, MarketDataConfig } from './market-data.config';
import {
  MarketHistoryClient,
  marketIdentity,
  orderMarketTicks,
} from './market-history.client';
import { MarketDataProcessor } from './market-data.processor';
import { MarketAtrConsumer } from './market-atr.consumer';
import { RedisCacheService } from '../redis-cache/redis-cache.service';
import { PriceAnalysisService } from './analysis/price-analysis.service';
import { AtrService } from '../atr/atr.service';
import { IngestionState } from './ingestion.state';
import { AlpacaAdapter } from './adapters/alpaca.adapter';
import { AlpacaDataBatch } from './alpaca.protocol';
import { MarketTick } from './dto/market-tick.dto';
import { TickInvalidationReason } from './ports/tick-consumer.interface';

@Injectable()
export class MarketRecoveryService implements OnModuleDestroy {
  private readonly startedAt = Date.now();
  private state: 'RECOVERING' | 'LIVE' | 'FAILED' | 'STOPPED' = 'RECOVERING';
  private buffer: MarketTick[] = [];
  private abort?: AbortController;
  private work?: Promise<void>;
  private retry?: NodeJS.Timeout;
  private connected = false;
  private epoch = 0;
  private gapStarted?: number;
  private lastError?: string;
  private recoveredThroughMs?: number;
  private checkpoint?: number;
  private checkpointIdentity?: string;
  private fatal = false;
  readonly metrics = {
    recoveries: 0,
    failures: 0,
    historicalTicks: 0,
    lastDurationMs: 0,
  };
  constructor(
    @Inject(MARKET_DATA_CONFIG) private readonly config: MarketDataConfig,
    private readonly history: MarketHistoryClient,
    private readonly processor: MarketDataProcessor,
    private readonly consumer: MarketAtrConsumer,
    private readonly cache: RedisCacheService,
    private readonly analysis: PriceAnalysisService,
    private readonly atr: AtrService,
    private readonly ingestion: IngestionState,
    private readonly adapter: AlpacaAdapter,
  ) {
    processor.onInvalidation = (reason) => this.fault(reason);
  }
  private fault(reason: TickInvalidationReason) {
    if (
      reason === 'connection_unavailable' ||
      reason === 'shutdown' ||
      this.state === 'STOPPED'
    )
      return;
    this.epoch++;
    this.abort?.abort();
    this.processor.pause();
    this.gapStarted ??= performance.now();
    this.fatal = reason === 'correction' || reason === 'cancellation';
    this.state = this.fatal ? 'FAILED' : 'RECOVERING';
    this.lastError = this.fatal
      ? 'recovery_requires_corrected_history'
      : undefined;
    if (!this.fatal) this.launch();
  }

  disconnected() {
    if (!this.config.enabled || this.state === 'STOPPED') return;
    this.connected = false;
    this.epoch++;
    this.abort?.abort();
    clearTimeout(this.retry);
    this.buffer = [];
    this.gapStarted ??= performance.now();
    this.state = this.fatal ? 'FAILED' : 'RECOVERING';
    const wasLive = this.processor.getStatus().live;
    this.processor.setLive(false);
    // Also pause startup or a failed recovery where processor was never live.
    if (!wasLive) this.consumer.invalidate('connection_unavailable');
  }
  live() {
    if (this.state === 'STOPPED' || !this.config.enabled) return;
    this.connected = true;
    this.launch();
  }
  accept(batch: AlpacaDataBatch) {
    if (this.state === 'LIVE') {
      this.processor.accept(batch);
      return;
    }
    if (!this.connected || this.state === 'STOPPED') return;
    for (const message of batch.messages) {
      if (message.T !== 't') {
        const reason = message.T === 'c' ? 'correction' : 'cancellation';
        this.consumer.invalidate(reason);
        this.fault(reason);
        this.buffer = [];
        return;
      }
      const result = this.adapter.normalize(message, batch.receivedAtMs, true);
      if (!result.ok) continue;
      if (this.buffer.length >= this.config.recoveryMaxTicks) {
        this.abort?.abort();
        this.lastError = 'recovery_buffer_limit';
        break;
      }
      this.buffer.push(result.tick);
    }
  }
  private launch() {
    if (
      this.work ||
      !this.connected ||
      this.state === 'STOPPED' ||
      this.state === 'LIVE' ||
      this.fatal
    )
      return;
    clearTimeout(this.retry);
    const epoch = this.epoch;
    this.state = 'RECOVERING';
    this.ingestion.beginRecovery();
    const abort = (this.abort = new AbortController());
    const timeout = setTimeout(
      () => abort.abort(),
      this.config.recoveryTimeoutMs,
    );
    this.work = this.recover(abort.signal, epoch)
      .catch((error) => {
        if (epoch !== this.epoch || this.state === 'STOPPED') return;
        this.ingestion.beginRecovery();
        this.state = 'FAILED';
        this.metrics.failures++;
        // Errors are allowlisted; network messages/URLs and response bodies never escape.
        const message = error instanceof Error ? error.message : '';
        this.lastError = /^(history_|recovery_)[a-z0-9_]+$/.test(message)
          ? message
          : 'recovery_failed';
      })
      .finally(() => {
        clearTimeout(timeout);
        this.work = undefined;
        if (
          this.connected &&
          this.state !== 'LIVE' &&
          this.state !== 'STOPPED' &&
          !this.fatal
        ) {
          this.retry = setTimeout(() => this.launch(), 500);
          this.retry.unref();
        }
      });
  }
  private async recover(signal: AbortSignal, epoch: number) {
    const started = this.gapStarted ?? performance.now();
    await this.processor.whenSettled(signal);
    signal.throwIfAborted();
    const existing = (
      await this.cache.recoveryWindow(this.config.symbol)
    ).filter((t) => t.feed === this.config.feed);
    if (this.checkpoint === undefined && existing.length)
      this.checkpointIdentity = marketIdentity(existing.at(-1)!);
    const checkpoint = (this.checkpoint ??=
      existing.at(-1)?.eventTimeMs ??
      this.recoveredThroughMs ??
      this.startedAt);
    const end = Date.now();
    // Inclusive start deliberately overlaps the last committed millisecond.
    const recovered = await this.history.fetch(checkpoint, end, signal);
    if (
      this.checkpointIdentity &&
      !recovered.some((t) => marketIdentity(t) === this.checkpointIdentity)
    )
      throw new Error('history_checkpoint_missing');
    await this.consumer.prepareRecovery(existing.length > 0, this.startedAt);
    let pending = recovered;
    while (true) {
      signal.throwIfAborted();
      const unique = new Map<string, MarketTick>();
      for (const tick of [...pending, ...this.buffer.splice(0)])
        unique.set(marketIdentity(tick), tick);
      for (const tick of orderMarketTicks([...unique.values()])) {
        signal.throwIfAborted();
        await this.consumer.consume(tick, { signal, recovery: true });
      }
      pending = [];
      if (this.buffer.length) continue;
      const window = (
        await this.cache.recoveryWindow(this.config.symbol)
      ).filter((t) => t.feed === this.config.feed);
      signal.throwIfAborted();
      if (epoch !== this.epoch || !this.connected)
        throw new Error('recovery_cancelled');
      this.analysis.restore(window, false);
      await this.atr.rebuildRecovered(end);
      signal.throwIfAborted();
      // Append the tail to the restored window; don't repeatedly rebuild the full
      // retained history while a producer keeps filling the buffer.
      while (this.buffer.length) {
        for (const tick of orderMarketTicks(this.buffer.splice(0))) {
          signal.throwIfAborted();
          await this.consumer.consume(tick, {
            signal,
            recovery: true,
            restoreAnalysis: true,
          });
        }
      }
      signal.throwIfAborted();
      if (epoch !== this.epoch || !this.connected)
        throw new Error('recovery_cancelled');
      this.ingestion.recovered();
      this.recoveredThroughMs = end;
      this.checkpoint = undefined;
      this.checkpointIdentity = undefined;
      this.analysis.resume();
      this.state = 'LIVE';
      this.lastError = undefined;
      this.metrics.recoveries++;
      this.metrics.historicalTicks += recovered.length;
      this.metrics.lastDurationMs = performance.now() - started;
      this.gapStarted = undefined;
      this.processor.setLive(true);
      return;
    }
  }
  getStatus() {
    return {
      state: this.state,
      bufferDepth: this.buffer.length,
      recoveredThroughMs: this.recoveredThroughMs,
      lastError: this.lastError,
      ...this.metrics,
    };
  }
  async onModuleDestroy() {
    this.state = 'STOPPED';
    this.connected = false;
    this.epoch++;
    clearTimeout(this.retry);
    this.abort?.abort();
    await this.work;
    this.processor.onInvalidation = undefined;
  }
}
