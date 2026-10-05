import { Logger } from "@nestjs/common";
import { parseMarketDataConfig } from "./market-data.config";
import { MarketRecoveryService } from "./market-recovery.service";
import { MarketHistoryClient } from "./market-history.client";
import { MarketDataProcessor } from "./market-data.processor";
import { MarketAtrConsumer } from "./market-atr.consumer";
import { TwelveDataAdapter } from "./adapters/twelve-data.adapter";
import { AlpacaAdapter } from "./adapters/alpaca.adapter";
import { PriceAnalysisService } from "./analysis/price-analysis.service";
import { RedisCacheService } from "../redis-cache/redis-cache.service";
import { AtrService } from "../atr/atr.service";
import { AtrConfig, defaultAtrOptions } from "../atr/atr.config";
import { TelemetryGateway } from "../telemetry/telemetry.gateway";
import { InvestmentAnalysisService } from "../hedging/investment-analysis.service";
import { IngestionState } from "./ingestion.state";
import { waitUntil } from "../../testing/mock-provider";
import { MarketDataBatch } from "./market-data.protocol";

describe("Twelve Data recovery without trade replay", () => {
  const config = parseMarketDataConfig({
    MARKET_DATA_ENABLED: "true",
    MARKET_DATA_PROVIDER: "twelvedata",
    TWELVE_DATA_API_KEY: "test-key",
    MARKET_DATA_RECOVERY_MAX_TICKS: "2",
    MARKET_DATA_MAX_TICK_AGE_MS: "2000",
    MARKET_DATA_RECOVERY_TIMEOUT_MS: "100",
  });
  let recovery: MarketRecoveryService;
  let processor: MarketDataProcessor;
  let analysis: PriceAnalysisService;
  let ingestion: IngestionState;
  let history: MarketHistoryClient;
  let cache: {
    advanceCoverage: jest.Mock;
    appendTick: jest.Mock;
    recoveryWindow: jest.Mock;
  };
  let atr: { invalidateSymbol: jest.Mock };
  let gateway: {
    broadcastMarketTick: jest.Mock;
    broadcastMarketDataQuality: jest.Mock;
  };
  beforeEach(() => {
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    cache = {
      advanceCoverage: jest.fn().mockResolvedValue(undefined),
      appendTick: jest.fn().mockResolvedValue({ accepted: true }),
      recoveryWindow: jest.fn(),
    };
    atr = { invalidateSymbol: jest.fn() };
    gateway = {
      broadcastMarketTick: jest.fn(),
      broadcastMarketDataQuality: jest.fn(),
    };
    ingestion = new IngestionState();
    analysis = new PriceAnalysisService(
      config,
      gateway as unknown as TelemetryGateway,
      new InvestmentAnalysisService(),
    );
    const consumer = new MarketAtrConsumer(
      config,
      { options: defaultAtrOptions } as AtrConfig,
      cache as unknown as RedisCacheService,
      atr as unknown as AtrService,
      analysis,
      ingestion,
      { now: () => Date.now(), monotonic: () => performance.now() },
    );
    consumer.onModuleInit();
    processor = new MarketDataProcessor(
      config,
      new TwelveDataAdapter(config),
      consumer,
    );
    history = new MarketHistoryClient(config, new AlpacaAdapter(config));
    jest.spyOn(history, "fetch");
    recovery = new MarketRecoveryService(
      config,
      history,
      processor,
      consumer,
      cache as unknown as RedisCacheService,
      analysis,
      atr as unknown as AtrService,
      ingestion,
      new AlpacaAdapter(config),
    );
  });
  afterEach(async () => {
    await recovery.onModuleDestroy();
    await processor.whenIdle();
    jest.restoreAllMocks();
  });
  function batch(
    price = 100,
    timestamp = Math.floor(Date.now() / 1000),
  ): MarketDataBatch {
    return {
      messages: [
        {
          T: "price",
          event: "price",
          symbol: "QQQ",
          currency: "USD",
          exchange: "NASDAQ",
          price,
          timestamp,
        },
      ],
      receivedAtMs: Date.now(),
      receivedAtMonotonicMs: performance.now(),
    };
  }
  it("buffers price events during startup and delivers after the ATR boundary is stored", async () => {
    recovery.live();
    const input = batch();
    recovery.accept(input);
    await waitUntil(() => processor.getStatus().delivered === 1);
    expect(recovery.getStatus()).toMatchObject({
      state: "LIVE",
      recoveredThroughMs: 0,
      historicalTicks: 0,
    });
    expect(history.fetch).not.toHaveBeenCalled();
    expect(cache.recoveryWindow).not.toHaveBeenCalled();
    expect(cache.advanceCoverage.mock.invocationCallOrder[0]).toBeLessThan(
      cache.appendTick.mock.invocationCallOrder[0],
    );
    expect(gateway.broadcastMarketTick).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "twelvedata",
        receivedAtMs: input.receivedAtMs,
      }),
    );
    expect(analysis.getStatus().marketReference.simulated).toBe(false);
  });
  it("refuses Alpaca HTTP history without making any request or leaking the key", async () => {
    const request = jest.spyOn(globalThis, "fetch");
    await expect(
      history.fetch(
        Date.now() - 1000,
        Date.now(),
        new AbortController().signal,
      ),
    ).rejects.toThrow("history_tick_replay_unavailable");
    expect(request).not.toHaveBeenCalled();
  });
  it("clears the analysis on disconnect and leaves persisted ticks untouched", async () => {
    recovery.live();
    recovery.accept(batch());
    await waitUntil(() => processor.getStatus().delivered === 1);
    recovery.disconnected();
    expect(analysis.getStatus()).toMatchObject({ points: 0, recovering: true });
    expect(ingestion.recovering).toBe(true);
    recovery.live();
    await waitUntil(() => recovery.getStatus().state === "LIVE");
    expect(analysis.getStatus()).toMatchObject({
      points: 0,
      recovering: false,
      fresh: false,
    });
    expect(cache.appendTick).toHaveBeenCalledTimes(1);
    expect(cache.advanceCoverage).toHaveBeenCalledTimes(2);
    expect(history.fetch).not.toHaveBeenCalled();
  });
  it("rejects old buffered prices using original receipt and event times", async () => {
    let release!: () => void;
    cache.advanceCoverage.mockImplementationOnce(
      () =>
        new Promise<void>((r) => {
          release = r;
        }),
    );
    recovery.live();
    await waitUntil(() => !!release);
    recovery.accept(batch(100, Math.floor(Date.now() / 1000) - 10));
    release();
    await waitUntil(() => recovery.getStatus().state === "LIVE");
    expect(processor.getStatus().rejected.stale).toBe(1);
    expect(cache.appendTick).not.toHaveBeenCalled();
  });
  it("does not resume or publish buffered data after a disconnect during preparation", async () => {
    let release!: () => void;
    cache.advanceCoverage.mockImplementationOnce(
      () =>
        new Promise<void>((r) => {
          release = r;
        }),
    );
    recovery.live();
    await waitUntil(() => !!release);
    recovery.accept(batch());
    recovery.disconnected();
    release();
    await new Promise((r) => setTimeout(r, 20));
    expect(ingestion.recovering).toBe(true);
    expect(processor.getStatus().live).toBe(false);
    expect(cache.appendTick).not.toHaveBeenCalled();
    recovery.live();
    await waitUntil(() => recovery.getStatus().state === "LIVE");
  });
  it("keeps delivery gated after Redis failure and retries without remote history", async () => {
    cache.advanceCoverage.mockRejectedValueOnce(
      new Error("private database details"),
    );
    recovery.live();
    await waitUntil(() => recovery.getStatus().state === "FAILED");
    expect(recovery.getStatus().lastError).toBe("recovery_failed");
    expect(processor.getStatus().live).toBe(false);
    recovery.live();
    await waitUntil(() => recovery.getStatus().state === "LIVE");
    expect(history.fetch).not.toHaveBeenCalled();
  });
  it("bounds buffered prices and discards the interrupted window on overflow", async () => {
    let release!: () => void;
    cache.advanceCoverage.mockImplementationOnce(
      () =>
        new Promise<void>((r) => {
          release = r;
        }),
    );
    recovery.live();
    await waitUntil(() => !!release);
    recovery.accept(batch());
    recovery.accept(batch());
    recovery.accept(batch());
    expect(recovery.getStatus().bufferDepth).toBe(0);
    expect(analysis.getStatus().lastInvalidation).toBe("queue_overflow");
    release();
    await new Promise((r) => setTimeout(r, 20));
    expect(cache.appendTick).not.toHaveBeenCalled();
    recovery.live();
    await waitUntil(() => recovery.getStatus().state === "LIVE");
  });
});
