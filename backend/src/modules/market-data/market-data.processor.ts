import { Inject, Injectable, Logger } from '@nestjs/common';
import { performance } from 'node:perf_hooks';
import { MARKET_DATA_CONFIG, MarketDataConfig } from './market-data.config';
import { MarketDataBatch } from './market-data.protocol';
import {
  MARKET_DATA_ADAPTER,
  MarketDataAdapter,
} from './ports/market-data-adapter.interface';
import { MarketTick } from './dto/market-tick.dto';
import {
  TICK_CONSUMER,
  TickConsumer,
  TickInvalidationReason,
  StaleTickDeliveryError,
} from './ports/tick-consumer.interface';

const TIMEOUT = Symbol('consumer_timeout');
const ABORTED = Symbol('delivery_aborted');

@Injectable()
export class MarketDataProcessor {
  onInvalidation?: (reason: TickInvalidationReason) => void;
  private readonly logger = new Logger(MarketDataProcessor.name);
  private live = false;
  private generation = 0;
  private queue: {
    tick: MarketTick;
    generation: number;
    receivedAtMonotonicMs: number;
  }[] = [];
  private readonly latencySamples: number[] = [];
  private latencyCount = 0;
  private latencyTotalMs = 0;
  private latencyMaxMs = 0;
  private lastEventAgeMs?: number;
  private running = false;
  private blocked = false;
  private invalidationFailed = false;
  private activeDelivery?: AbortController;
  private readonly seen = new Map<string, true>();
  private lastEventTimeNs?: bigint;
  private readonly idleWaiters: (() => void)[] = [];
  private readonly counters = {
    received: 0,
    valid: 0,
    delivered: 0,
    duplicates: 0,
    outOfOrder: 0,
    dropped: 0,
    controls: 0,
    consumerErrors: 0,
  };
  private readonly rejected: Record<string, number> = {};

  constructor(
    @Inject(MARKET_DATA_CONFIG) private readonly config: MarketDataConfig,
    @Inject(MARKET_DATA_ADAPTER) private readonly adapter: MarketDataAdapter,
    @Inject(TICK_CONSUMER) private readonly consumer: TickConsumer,
  ) {}

  setLive(live: boolean): void {
    if (this.live === live) return;
    this.live = live;
    if (!live) this.invalidate('connection_unavailable');
  }

  accept(batch: MarketDataBatch): void {
    if (!this.live) return;
    for (const message of batch.messages) {
      this.counters.received++;
      if (message.T === 'c' || message.T === 'x') {
        if (message.S === this.config.symbol) {
          this.counters.controls++;
          this.invalidate(message.T === 'c' ? 'correction' : 'cancellation');
        } else this.reject('symbol');
        continue;
      }
      const result = this.adapter.normalize(message, batch.receivedAtMs);
      if (!result.ok) {
        this.reject(result.reason);
        continue;
      }
      this.counters.valid++;
      const { tick, eventTimeNs } = result;
      // Fecha UTC derivada; timestamps con offset representan la misma sesión UTC.
      const date = new Date(tick.eventTimeMs).toISOString().slice(0, 10);
      const key = `${tick.feed}:${tick.symbol}:${tick.exchange}:${date}:${tick.eventId}`;
      if (this.seen.has(key)) {
        this.counters.duplicates++;
        continue;
      }
      if (
        this.lastEventTimeNs !== undefined &&
        eventTimeNs < this.lastEventTimeNs
      ) {
        this.counters.outOfOrder++;
        continue;
      }
      if (this.blocked || this.invalidationFailed) {
        this.counters.dropped++;
        continue;
      }
      if (this.queue.length >= this.config.queueCapacity) {
        this.counters.dropped++;
        this.invalidate('queue_overflow');
        continue;
      }
      this.seen.set(key, true);
      if (this.seen.size > this.config.dedupCapacity)
        this.seen.delete(this.seen.keys().next().value!);
      this.lastEventTimeNs = eventTimeNs;
      this.queue.push({
        tick,
        generation: this.generation,
        receivedAtMonotonicMs: batch.receivedAtMonotonicMs,
      });
      void this.drain();
    }
  }

  private reject(reason: string): void {
    this.rejected[reason] = (this.rejected[reason] ?? 0) + 1;
  }

  invalidate(reason: TickInvalidationReason): void {
    this.generation++;
    this.counters.dropped += this.queue.length;
    this.queue = [];
    this.seen.clear();
    this.lastEventTimeNs = undefined;
    this.activeDelivery?.abort();
    try {
      this.consumer.invalidate(reason);
      this.invalidationFailed = false;
    } catch {
      this.invalidationFailed = true;
      this.counters.consumerErrors++;
      this.logger.warn('market_data_consumer_invalidation_failed');
    }
    this.logger.warn(
      JSON.stringify({ event: 'market_data_analysis_invalidated', reason }),
    );
    this.onInvalidation?.(reason);
  }
  pause(): void { this.live = false; }

  private async drain(): Promise<void> {
    if (this.running || this.blocked || this.invalidationFailed) return;
    this.running = true;
    try {
      while (
        this.live &&
        this.queue.length &&
        !this.blocked &&
        !this.invalidationFailed
      ) {
        const entry = this.queue.shift()!;
        if (entry.generation !== this.generation) continue;
        const age = Date.now() - entry.tick.eventTimeMs;
        if (
          age > this.config.maxTickAgeMs ||
          age < -this.config.futureToleranceMs
        ) {
          this.reject('stale_delivery');
          this.invalidate('stale_delivery');
          continue;
        }
        const abort = new AbortController();
        this.activeDelivery = abort;
        let settled = false;
        const work = Promise.resolve().then(() => {
          if (!abort.signal.aborted)
            return this.consumer.consume(entry.tick, { signal: abort.signal });
        });
        void work.then(
          () => {
            settled = true;
          },
          () => {
            settled = true;
          },
        );
        let timer: NodeJS.Timeout | undefined;
        let onAbort!: () => void;
        const deadline = new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(TIMEOUT),
            this.config.consumerTimeoutMs,
          );
          onAbort = () => reject(ABORTED);
          abort.signal.addEventListener('abort', onAbort, { once: true });
        });
        try {
          await Promise.race([work, deadline]);
          if (!abort.signal.aborted && entry.generation === this.generation) {
            this.counters.delivered++;
            const latency = Math.max(
              0,
              performance.now() - entry.receivedAtMonotonicMs,
            );
            this.latencySamples.push(latency);
            if (this.latencySamples.length > 512) this.latencySamples.shift();
            this.latencyCount++;
            this.latencyTotalMs += latency;
            this.latencyMaxMs = Math.max(this.latencyMaxMs, latency);
            this.lastEventAgeMs = Date.now() - entry.tick.eventTimeMs;
          }
        } catch (error) {
          this.counters.dropped++;
          if (error !== ABORTED) {
            if (error instanceof StaleTickDeliveryError) {
              this.reject('stale_delivery');
              this.invalidate('stale_delivery');
            } else {
              this.counters.consumerErrors++;
              this.invalidate(
                error === TIMEOUT ? 'consumer_timeout' : 'consumer_error',
              );
            }
          }
          if (!settled) {
            // No iniciar otra entrega mientras el consumidor anterior siga pendiente.
            this.blocked = true;
            void work
              .finally(() => {
                this.blocked = false;
                void this.drain();
              })
              .catch(() => undefined);
          }
        } finally {
          clearTimeout(timer);
          abort.signal.removeEventListener('abort', onAbort);
          if (this.activeDelivery === abort) this.activeDelivery = undefined;
        }
      }
    } finally {
      this.running = false;
      for (const resolve of this.idleWaiters.splice(0)) resolve();
    }
  }

  whenIdle(): Promise<void> {
    if (!this.running && !this.queue.length) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }
  async whenSettled(signal?: AbortSignal): Promise<void> {
    while (this.running || this.blocked) {
      signal?.throwIfAborted();
      await new Promise(resolve => setTimeout(resolve, 1));
    }
  }

  getStatus() {
    const sorted = [...this.latencySamples].sort((a, b) => a - b);
    return {
      live: this.live,
      processing:
        this.blocked || this.invalidationFailed
          ? 'BLOCKED'
          : this.running
            ? 'RUNNING'
            : 'IDLE',
      queueDepth: this.queue.length,
      dedupEntries: this.seen.size,
      ...this.counters,
      receiptToConsumerLatencyMs: {
        count: this.latencyCount,
        last: this.latencySamples.at(-1) ?? null,
        max: this.latencyCount ? this.latencyMaxMs : null,
        average: this.latencyCount
          ? this.latencyTotalMs / this.latencyCount
          : null,
        p95: sorted.length ? sorted[Math.ceil(sorted.length * 0.95) - 1] : null,
        sampleWindow: sorted.length,
      },
      lastEventAgeAtDeliveryMs: this.lastEventAgeMs ?? null,
      rejected: { ...this.rejected },
    };
  }
}
