import { Inject, Injectable, OnModuleInit } from "@nestjs/common";
import { createHash } from "node:crypto";
import { MARKET_DATA_CONFIG, MarketDataConfig } from "./market-data.config";
import { MarketTick } from "./dto/market-tick.dto";
import {
  TickConsumer,
  TickDeliveryContext,
  TickInvalidationReason,
} from "./ports/tick-consumer.interface";
import { PriceAnalysisService } from "./analysis/price-analysis.service";
import { RedisCacheService } from "../redis-cache/redis-cache.service";
import { AtrService } from "../atr/atr.service";
import { AtrConfig } from "../atr/atr.config";
import { IngestionState } from "./ingestion.state";
import { MarketClock, MINUTE_MS, minuteStart } from "./market.types";

/** One delivery path: persist before analysis/emission; never emit a second tick. */
@Injectable()
export class MarketAtrConsumer implements TickConsumer, OnModuleInit {
  private generation = 0;
  private needsBoundary = true;
  constructor(
    @Inject(MARKET_DATA_CONFIG) private readonly config: MarketDataConfig,
    private readonly atrConfig: AtrConfig,
    private readonly cache: RedisCacheService,
    private readonly atr: AtrService,
    private readonly analysis: PriceAnalysisService,
    private readonly ingestion: IngestionState,
    private readonly clock: MarketClock,
  ) {}

  onModuleInit() {
    if (!this.config.enabled) return;
    if (!this.atrConfig.options.symbols.includes(this.config.symbol))
      throw new Error("ATR_SYMBOLS must include the market data symbol");
    this.ingestion.beginRecovery();
  }

  async consume(
    tick: MarketTick,
    context?: TickDeliveryContext,
  ): Promise<void> {
    if (context?.signal.aborted) return;
    if (tick.symbol !== this.config.symbol || tick.feed !== this.config.feed)
      throw new Error("market_data_tick_source_mismatch");
    const generation = this.generation;
    const current = () =>
      !context?.signal.aborted && generation === this.generation;
    if (this.needsBoundary && !context?.recovery) {
      // Fallback for direct consumers without the recovery coordinator:
      // exclude the partial startup minute instead of inventing a complete OHLC.
      const boundary =
        minuteStart(Math.max(this.clock.now(), tick.eventTimeMs)) + MINUTE_MS;
      await this.cache.advanceCoverage(tick.symbol, boundary);
      if (!current()) return;
      this.atr.invalidateSymbol(tick.symbol, boundary);
    }
    const date = new Date(tick.eventTimeMs).toISOString().slice(0, 10);
    const id = createHash("sha256")
      .update(
        JSON.stringify([
          tick.provider,
          tick.feed,
          tick.symbol,
          tick.exchange,
          date,
          tick.eventId,
        ]),
      )
      .digest("hex");
    const result = await this.cache.appendTick({
      id,
      symbol: tick.symbol,
      price: tick.price,
      volume: tick.volume,
      eventTime: tick.eventTimeMs,
      receivedAt: tick.receivedAtMs,
      source: tick,
    }, context?.recovery ?? false);
    if (!current()) return;
    if (!result.accepted && result.reason !== "duplicate")
      throw new Error(`market_data_cache_${result.reason}`);
    if (context?.recovery) {
      if (context.restoreAnalysis) this.analysis.appendRecovered(tick);
      return;
    }
    this.needsBoundary = false;
    if (this.ingestion.recovering) this.ingestion.recovered();
    if (result.accepted) await this.analysis.consume(tick, context);
  }

  invalidate(reason: TickInvalidationReason): void {
    this.generation++;
    this.ingestion.beginRecovery();
    if (['connection_unavailable', 'shutdown', 'consumer_error', 'consumer_timeout', 'queue_overflow', 'stale_delivery'].includes(reason)) {
      this.atr.suspendSymbol(this.config.symbol);
      this.analysis.suspend(reason);
    } else {
      this.needsBoundary = true;
      this.atr.invalidateSymbol(this.config.symbol);
      this.analysis.invalidate(reason);
    }
  }
  async prepareRecovery(hasHistory: boolean, startedAt: number): Promise<void> {
    if (!hasHistory && this.needsBoundary)
      await this.cache.advanceCoverage(this.config.symbol, minuteStart(startedAt) + MINUTE_MS);
    this.needsBoundary = false;
  }
}
