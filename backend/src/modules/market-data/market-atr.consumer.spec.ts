import { MarketAtrConsumer } from "./market-atr.consumer";
import { parseMarketDataConfig } from "./market-data.config";
import { normalizedTick, TEST_TIME_MS } from "./testing/market-tick.fixture";
import { AtrConfig, defaultAtrOptions } from "../atr/atr.config";
import { RedisCacheService } from "../redis-cache/redis-cache.service";
import { AtrService } from "../atr/atr.service";
import { PriceAnalysisService } from "./analysis/price-analysis.service";
import { IngestionState } from "./ingestion.state";

describe("Market data to ATR delivery", () => {
  const config = parseMarketDataConfig({
    MARKET_DATA_ENABLED: "true",
    MARKET_DATA_FEED: "mock",
  });
  let cache: { appendTick: jest.Mock; advanceCoverage: jest.Mock };
  let atr: { invalidateSymbol: jest.Mock; suspendSymbol: jest.Mock };
  let analysis: { consume: jest.Mock; invalidate: jest.Mock; suspend: jest.Mock };
  let state: IngestionState;
  let consumer: MarketAtrConsumer;
  beforeEach(() => {
    cache = {
      appendTick: jest.fn().mockResolvedValue({ accepted: true }),
      advanceCoverage: jest.fn().mockResolvedValue(undefined),
    };
    atr = { invalidateSymbol: jest.fn(), suspendSymbol: jest.fn() };
    analysis = {
      consume: jest.fn().mockResolvedValue(undefined),
      invalidate: jest.fn(),
      suspend: jest.fn(),
    };
    state = new IngestionState();
    consumer = new MarketAtrConsumer(
      config,
      { options: defaultAtrOptions } as AtrConfig,
      cache as unknown as RedisCacheService,
      atr as unknown as AtrService,
      analysis as unknown as PriceAnalysisService,
      state,
      { now: () => TEST_TIME_MS, monotonic: () => 0 },
    );
    consumer.onModuleInit();
  });
  it("preserves source timestamps, persists first, and excludes the partial startup minute", async () => {
    const tick = normalizedTick(TEST_TIME_MS - 10);
    expect(state.recovering).toBe(true);
    await consumer.consume(tick);
    expect(cache.advanceCoverage).toHaveBeenCalledWith(
      "QQQ",
      TEST_TIME_MS + 60000,
    );
    expect(cache.appendTick).toHaveBeenCalledWith(
      expect.objectContaining({
        eventTime: tick.eventTimeMs,
        receivedAt: tick.receivedAtMs,
        price: tick.price,
      }),
      false,
    );
    expect(cache.appendTick.mock.invocationCallOrder[0]).toBeLessThan(
      analysis.consume.mock.invocationCallOrder[0],
    );
    expect(analysis.consume).toHaveBeenCalledTimes(1);
    expect(state.recovering).toBe(false);
  });
  it("uses stable IDs across reconnect and does not emit duplicates", async () => {
    const tick = normalizedTick();
    await consumer.consume(tick);
    consumer.invalidate("connection_unavailable");
    cache.appendTick.mockResolvedValue({
      accepted: false,
      reason: "duplicate",
    });
    await consumer.consume(tick);
    expect(cache.appendTick.mock.calls[0][0].id).toBe(
      cache.appendTick.mock.calls[1][0].id,
    );
    expect(analysis.consume).toHaveBeenCalledTimes(1);
    expect(analysis.suspend).toHaveBeenCalledWith("connection_unavailable");
  });
  it("does not invalidate an ATR snapshot version for ordinary live ticks", async () => {
    await consumer.consume(normalizedTick());
    const version = state.version;
    await consumer.consume(normalizedTick(TEST_TIME_MS, 101, "next"));
    expect(state.version).toBe(version);
  });
  it("does not publish a delayed cache completion after invalidation", async () => {
    await consumer.consume(normalizedTick());
    let resolve!: (result: { accepted: true }) => void;
    cache.appendTick.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const work = consumer.consume(normalizedTick(TEST_TIME_MS, 101, "second"));
    consumer.invalidate("consumer_timeout");
    resolve({ accepted: true });
    await work;
    expect(analysis.consume).toHaveBeenCalledTimes(1);
    expect(state.recovering).toBe(true);
  });
  it("leaves recovery gated and propagates Redis failures", async () => {
    cache.appendTick.mockRejectedValue(new Error("offline"));
    await expect(consumer.consume(normalizedTick())).rejects.toThrow("offline");
    expect(analysis.consume).not.toHaveBeenCalled();
    expect(state.recovering).toBe(true);
  });
  it("rejects cache discards and mismatched sources", async () => {
    cache.appendTick.mockResolvedValue({ accepted: false, reason: "late" });
    await expect(consumer.consume(normalizedTick())).rejects.toThrow(
      "cache_late",
    );
    await expect(
      consumer.consume({ ...normalizedTick(), symbol: "NDX" }),
    ).rejects.toThrow("source_mismatch");
    expect(analysis.consume).not.toHaveBeenCalled();
  });
  it("ignores cancelled work without modifying Redis", async () => {
    const abort = new AbortController();
    abort.abort();
    await consumer.consume(normalizedTick(), { signal: abort.signal });
    expect(cache.appendTick).not.toHaveBeenCalled();
    expect(cache.advanceCoverage).not.toHaveBeenCalled();
  });
});
