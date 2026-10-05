import { once } from "events";
import { readFileSync, mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { randomUUID } from "crypto";
import { ConfigService } from "@nestjs/config";
import { Logger } from "@nestjs/common";
import { AtrConfig, defaultAtrOptions } from "../modules/atr/atr.config";
import { AtrService } from "../modules/atr/atr.service";
import {
  MarketClock,
  MINUTE_MS,
  minuteStart,
  Tick,
} from "../modules/market-data/market.types";
import { IngestionState } from "../modules/market-data/ingestion.state";
import { ReplayFeedClient } from "../modules/market-data/replay-feed.client";
import { RedisCacheService } from "../modules/redis-cache/redis-cache.service";
import { TelemetryGateway } from "../modules/telemetry/telemetry.gateway";
import { TelemetryService } from "../modules/telemetry/telemetry.service";
import { MockProvider, percentiles, waitUntil } from "./mock-provider";
import { MarketAtrConsumer } from "../modules/market-data/market-atr.consumer";
import { parseMarketDataConfig } from "../modules/market-data/market-data.config";
import { PriceAnalysisService } from "../modules/market-data/analysis/price-analysis.service";
import { normalizedTick } from "../modules/market-data/testing/market-tick.fixture";

import { TwelveDataAdapter } from '../modules/market-data/adapters/twelve-data.adapter';
import { AlpacaAdapter } from '../modules/market-data/adapters/alpaca.adapter';
import { MarketHistoryClient } from '../modules/market-data/market-history.client';
import { MarketRecoveryService } from '../modules/market-data/market-recovery.service';
import { MarketDataProcessor } from '../modules/market-data/market-data.processor';
import { InvestmentAnalysisService } from '../modules/hedging/investment-analysis.service';

const integration =
  process.env.RUN_REDIS_TESTS === "1" ? describe : describe.skip;
const start = Date.UTC(2026, 9, 4, 12);
integration("real Redis and WebSocket integration", () => {
  let cache: RedisCacheService;
  let config: AtrConfig;
  let clock: MarketClock;
  let current: number;
  let ingestion: IngestionState;
  let gateway: { broadcastTick: jest.Mock; broadcastAtr: jest.Mock };
  const tick = (id: string, eventTime: number, price = 100): Tick => ({
    id,
    symbol: "NDX",
    price,
    volume: 1,
    eventTime,
    receivedAt: current,
  });
  beforeEach(async () => {
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    current = start + 60 * MINUTE_MS;
    clock = { now: () => current, monotonic: () => performance.now() };
    config = {
      options: {
        ...defaultAtrOptions,
        symbols: ["NDX", "QQQ"],
        prefix: `ritech:test:${randomUUID()}`,
      },
    } as AtrConfig;
    cache = new RedisCacheService(
      new ConfigService({
        REDIS_HOST: process.env.REDIS_TEST_HOST ?? "127.0.0.1",
        REDIS_PORT: Number(process.env.REDIS_TEST_PORT ?? 6379),
        REDIS_PASS: process.env.REDIS_TEST_PASSWORD ?? "ritech_dev",
      }),
      config,
      clock,
    );
    cache.onModuleInit();
    await once(cache.getClient(), "ready");
    ingestion = new IngestionState();
    gateway = { broadcastTick: jest.fn(), broadcastAtr: jest.fn() };
  });
  afterEach(async () => {
    if (cache?.getClient().status === "ready")
      await cache.getClient().del(...cache.keys("NDX"), ...cache.keys("QQQ"));
    cache?.onModuleDestroy();
    jest.restoreAllMocks();
  });
  it('preserves Twelve Data observation order in Redis and restarts ATR coverage after a gap', async () => {
    current = start;
    jest.spyOn(Date, 'now').mockImplementation(() => current);
    const marketConfig = parseMarketDataConfig({
      MARKET_DATA_ENABLED: 'true', MARKET_DATA_PROVIDER: 'twelvedata', MARKET_DATA_FEED: 'mock',
    });
    const output = { broadcastMarketTick: jest.fn(), broadcastInvestmentUpdate: jest.fn(),
      broadcastPriceAlert: jest.fn(), broadcastMarketDataQuality: jest.fn(), broadcastAtr: jest.fn() };
    const engine = new AtrService(config, cache, clock, output as unknown as TelemetryGateway, ingestion);
    const analysis = new PriceAnalysisService(marketConfig, output as unknown as TelemetryGateway, new InvestmentAnalysisService());
    const consumer = new MarketAtrConsumer(marketConfig, config, cache, engine, analysis, ingestion, clock);
    consumer.onModuleInit();
    const processor = new MarketDataProcessor(marketConfig, new TwelveDataAdapter(marketConfig), consumer);
    const history = new MarketHistoryClient(marketConfig, new AlpacaAdapter(marketConfig));
    const query = jest.spyOn(history, 'fetch');
    const recovery = new MarketRecoveryService(marketConfig, history, processor, consumer, cache,
      analysis, engine, ingestion, new AlpacaAdapter(marketConfig));
    const deliver = async (price: number) => {
      const delivered = processor.getStatus().delivered;
      recovery.accept({ messages: [{ T: 'price', event: 'price', symbol: 'QQQ', currency: 'USD',
        exchange: 'NASDAQ', price, timestamp: current / 1000 }],
        receivedAtMs: current, receivedAtMonotonicMs: performance.now() });
      await waitUntil(() => processor.getStatus().delivered === delivered + 1);
    };
    try {
      recovery.live();
      await waitUntil(() => recovery.getStatus().state === 'LIVE');
      current = start + MINUTE_MS;
      await deliver(100); await deliver(102); await deliver(100);
      const saved = await cache.recoveryWindow('QQQ');
      expect(saved.map(t => t.price)).toEqual([100, 102, 100]);
      expect(new Set(saved.map(t => t.eventId)).size).toBe(3);
      current += MINUTE_MS;
      const snapshot = await cache.readTicks('QQQ', start, current);
      expect(snapshot.coverageStart).toBe(start + MINUTE_MS);
      expect(snapshot.ticks.map(t => t.price)).toEqual([100, 102, 100]);
      recovery.disconnected();
      expect(analysis.getHistory().points).toBe(0);
      current += MINUTE_MS;
      recovery.live();
      await waitUntil(() => recovery.getStatus().state === 'LIVE');
      expect(analysis.getStatus().fresh).toBe(false);
      await deliver(90);
      expect(analysis.getHistory().points).toBe(1);
      expect(await cache.recoveryWindow('QQQ')).toHaveLength(4);
      const boundary = current + MINUTE_MS;
      current += 2 * MINUTE_MS;
      expect((await cache.readTicks('QQQ', start, current)).coverageStart).toBe(boundary);
      await engine.runCycle();
      expect(engine.snapshot().results.find(r => r.symbol === 'QQQ')).toMatchObject({
        status: 'insufficientData', atr: null, alert: false,
      });
      expect(query).not.toHaveBeenCalled();
    } finally {
      await recovery.onModuleDestroy(); engine.stop();
    }
  });
  it("keeps equal-millisecond ticks, stable order, rejects duplicate/disorder/late and validates inputs", async () => {
    expect(await cache.appendTick(tick("z", start, 100))).toEqual({
      accepted: true,
    });
    expect(await cache.appendTick(tick("a", start, 110))).toEqual({
      accepted: true,
    });
    expect(await cache.appendTick(tick("z", start, 999))).toEqual({
      accepted: false,
      reason: "duplicate",
    });
    expect(await cache.appendTick(tick("older", start - 1))).toEqual({
      accepted: false,
      reason: "outOfOrder",
    });
    expect(
      await cache.appendTick({ ...tick("bad", start), price: null }),
    ).toEqual({ accepted: false, reason: "invalidPrice" });
    expect(
      await cache.appendTick({ ...tick("badtime", start), eventTime: null }),
    ).toEqual({ accepted: false, reason: "invalidTimestamp" });
    const snapshot = await cache.readTicks("NDX", start, start + MINUTE_MS);
    expect(snapshot.ticks.map((t) => t.id)).toEqual(["z", "a"]);
    expect(snapshot.ticks.map((t) => t.price)).toEqual([100, 110]);
    expect(await cache.appendTick(tick("late", start + 1))).toEqual({
      accepted: false,
      reason: "late",
    });
    expect(await cache.getClient().ttl(cache.keys("NDX")[0])).toBeGreaterThan(
      14 * 60,
    );
  });
  it("prunes capacity atomically and reports incomplete minute coverage", async () => {
    Object.assign(config.options, { maxTicksPerSymbol: 2 });
    await cache.appendTick(tick("1", start));
    await cache.appendTick(tick("2", start + 1));
    await cache.appendTick(tick("3", start + MINUTE_MS));
    const snapshot = await cache.readTicks("NDX", start, start + 2 * MINUTE_MS);
    expect(snapshot.ticks).toHaveLength(2);
    expect(snapshot.coverageStart).toBe(start + MINUTE_MS);
    expect(await cache.getClient().hlen(cache.keys("NDX")[1])).toBe(2);
  });
  it("retains full JavaScript price precision through Lua and Redis", async () => {
    const price = 123456789.12345679;
    await cache.appendTick(tick("precise", start, price));
    const snapshot = await cache.readTicks("NDX", start, start + MINUTE_MS);
    expect(snapshot.ticks[0].price).toBe(price);
  });
  it("expires history by market time even when Redis TTL has not elapsed", async () => {
    Object.assign(config.options, {
      period: 1,
      baselineWindow: 1,
      retentionMinutes: 2,
    });
    current = start;
    await cache.appendTick(tick("1", start));
    current = start + 3 * MINUTE_MS;
    const snapshot = await cache.readTicks("NDX", start, current);
    expect(snapshot.ticks).toEqual([]);
    expect(snapshot.coverageStart).toBe(start + MINUTE_MS);
    expect(await cache.appendTick(tick("expired", start))).toEqual({
      accepted: false,
      reason: "expired",
    });
  });
  it("runs Redis -> minute OHLC -> ATR -> telemetry against the pandas fixture", async () => {
    const rows = readFileSync(
      join(
        __dirname,
        "../../../packages/atr_engine/test/fixtures/atr_reference.csv",
      ),
      "utf8",
    )
      .trim()
      .split(/\r?\n/)
      .slice(1)
      .map((row) => row.split(","));
    const telemetry = new TelemetryService(
      gateway as unknown as TelemetryGateway,
      cache,
      clock,
    );
    for (const [index, row] of rows.entries()) {
      for (let field = 1; field <= 4; field++) {
        await telemetry.processIncomingTick({
          id: `${index}:${field}`,
          symbol: "NDX",
          price: +row[field],
          volume: 1,
          eventTime: Date.parse(row[0]) + field * 10000,
        });
      }
    }
    const engine = new AtrService(
      config,
      cache,
      clock,
      gateway as unknown as TelemetryGateway,
      ingestion,
    );
    await engine.runCycle();
    engine.stop();
    const results = gateway.broadcastAtr.mock.calls
      .map((call) => call[0])
      .filter((result) => result.symbol === "NDX");
    expect(results).toHaveLength(60);
    for (let i = 0; i < rows.length; i++) {
      if (!rows[i][6]) expect(results[i].atr).toBeNull();
      else
        expect(Math.abs(results[i].atr - +rows[i][6])).toBeLessThanOrEqual(
          1e-6,
        );
    }
    expect(gateway.broadcastTick).toHaveBeenCalledTimes(240);
    expect(engine.metrics.failures).toBe(0);
  });
  it("connects normalized market ticks to Redis and ATR, compares all reference values, and resets safely without backfill", async () => {
    const rows = readFileSync(
      join(
        process.cwd(),
        "../packages/atr_engine/test/fixtures/atr_reference.csv",
      ),
      "utf8",
    )
      .trim()
      .split(/\r?\n/)
      .slice(1)
      .map((line) => line.split(","));
    const engine = new AtrService(
      config,
      cache,
      clock,
      gateway as unknown as TelemetryGateway,
      ingestion,
    );
    const analysis = {
      consume: jest.fn().mockResolvedValue(undefined),
      invalidate: jest.fn(),
      suspend: jest.fn(),
    };
    const consumer = new MarketAtrConsumer(
      parseMarketDataConfig({
        MARKET_DATA_PROVIDER: 'alpaca',
        MARKET_DATA_ENABLED: "true",
        MARKET_DATA_FEED: "mock",
      }),
      config,
      cache,
      engine,
      analysis as unknown as PriceAnalysisService,
      ingestion,
      clock,
    );
    consumer.onModuleInit();
    current = start - MINUTE_MS;
    await consumer.consume(normalizedTick(current, 100, "prime"));
    gateway.broadcastAtr.mockClear();
    for (let index = 0; index < rows.length; index++) {
      for (let field = 1; field <= 4; field++) {
        current = Date.parse(rows[index][0]) + field * 10000;
        await consumer.consume(
          normalizedTick(current, +rows[index][field], `${index}:${field}`),
        );
      }
      current = Date.parse(rows[index][0]) + MINUTE_MS;
      await engine.runCycle();
    }
    const results = gateway.broadcastAtr.mock.calls
      .map((call) => call[0])
      .filter((result) => result.symbol === "QQQ");
    expect(results).toHaveLength(60);
    for (let i = 0; i < rows.length; i++) {
      if (!rows[i][6]) expect(results[i].atr).toBeNull();
      else
        expect(Math.abs(results[i].atr - +rows[i][6])).toBeLessThanOrEqual(
          1e-6,
        );
    }
    // A historical repair can fill already sealed minutes without replaying alerts.
    const saved = await cache.recoveryWindow("QQQ");
    expect(saved).toHaveLength(241);
    const lastMinute = await cache.readTicks("QQQ", current - MINUTE_MS, current);
    for (const value of lastMinute.ticks) {
      await cache.getClient().zrem(cache.keys("QQQ")[0], value.id);
      await cache.getClient().hdel(cache.keys("QQQ")[1], value.id);
    }
    consumer.invalidate("connection_unavailable");
    const signal = new AbortController().signal;
    for (const source of saved.filter(t => t.eventTimeMs >= current - MINUTE_MS))
      await consumer.consume(source, { signal, recovery: true });
    gateway.broadcastAtr.mockClear();
    await engine.rebuildRecovered(current);
    expect(ingestion.recovering).toBe(true);
    const rebuilt = gateway.broadcastAtr.mock.calls.map(call => call[0]).filter(r => r.symbol === "QQQ");
    expect(rebuilt).toHaveLength(1);
    expect(rebuilt[0].alert).toBe(false);
    expect(Math.abs(rebuilt[0].atr - +rows.at(-1)![6])).toBeLessThanOrEqual(1e-6);
    expect(await cache.recoveryWindow("QQQ")).toHaveLength(saved.length);
    const before = await cache.getClient().hlen(cache.keys("QQQ")[1]);
    consumer.invalidate("connection_unavailable");
    expect(
      engine.snapshot().results.find((r) => r.symbol === "QQQ")?.status,
    ).toBe("gap");
    await consumer.consume(normalizedTick(current, 101, "after-cut"));
    expect(await cache.getClient().hlen(cache.keys("QQQ")[1])).toBe(before + 1);
    expect(await cache.readTicks("QQQ", start, current)).toMatchObject({
      coverageStart: start,
    });
    engine.stop();
  });
  it("recovers repeated disconnects under load without losing window or duplicating accepted ticks", async () => {
    current = minuteStart(Date.now());
    const provider = new MockProvider();
    const url = await provider.start();
    const telemetry = new TelemetryService(
      gateway as unknown as TelemetryGateway,
      cache,
      clock,
    );
    const client = new ReplayFeedClient(
      { url, reconnectMs: 100, maxPending: 10000, handshakeTimeoutMs: 5000 },
      clock,
      ingestion,
      (input) => telemetry.processIncomingTick(input),
    );
    const total = 360;
    const cuts = [90, 180, 270];
    const intervalMs = 4;
    const eventStart = current - 2 * MINUTE_MS;
    const scenarioStarted = performance.now();
    try {
      client.start();
      await waitUntil(() => !ingestion.recovering);
      for (let i = 0; i < total; i++) {
        if (cuts.includes(i)) provider.disconnectClients();
        provider.publish({
          id: `load:${i}`,
          symbol: "NDX",
          price: 100 + (i % 7),
          volume: 1,
          eventTime: eventStart + i,
        });
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
      await waitUntil(
        () => client.metrics.accepted === total && !ingestion.recovering,
      );
      await client.drain();
      const snapshot = await cache.readTicks("NDX", eventStart, current);
      const latency = percentiles(client.metrics.latenciesMs);
      const elapsedMs = performance.now() - scenarioStarted;
      const report = {
        generatedAt: new Date().toISOString(),
        scenario: "loopback replay protocol + real Redis",
        config: {
          ticks: total,
          symbols: 1,
          intervalMs,
          cuts,
          reconnectMs: 100,
        },
        elapsedMs,
        achievedTicksPerSecond: (total * 1000) / elapsedMs,
        accepted: client.metrics.accepted,
        duplicatesRejected: client.metrics.duplicate,
        discarded: client.metrics.discarded,
        recoveriesMs: client.metrics.recoveriesMs,
        latencyMs: latency,
        retainedTicks: snapshot.ticks.length,
        uniqueTicks: new Set(snapshot.ticks.map((t) => t.id)).size,
        limitation:
          "Synthetic local provider, not the production market connector. Latency measures local receive-to-cache completion.",
      };
      const reportPath =
        process.env.QA_REPORT_PATH ??
        join(
          __dirname,
          "../../../../reportes/atr_engine/streaming_metrics.json",
        );
      mkdirSync(dirname(reportPath), { recursive: true });
      writeFileSync(reportPath, JSON.stringify(report, null, 2));
      expect(snapshot.ticks).toHaveLength(total);
      expect(new Set(snapshot.ticks.map((t) => t.id)).size).toBe(total);
      expect(client.metrics.discarded).toBe(0);
      expect(client.metrics.duplicate).toBeGreaterThan(0);
      expect(client.metrics.recoveriesMs).toHaveLength(3);
      expect(Math.max(...client.metrics.recoveriesMs)).toBeLessThan(2000);
      expect(latency.max).toBeLessThan(200);
    } finally {
      await client.stop();
      await provider.stop();
    }
  }, 20000);
  it("replays uncommitted ticks after a cache failure and keeps ATR paused during recovery", async () => {
    const provider = new MockProvider();
    const url = await provider.start();
    provider.publish({
      id: "retry:1",
      symbol: "NDX",
      price: 100,
      volume: 1,
      eventTime: start,
    });
    provider.publish({
      id: "retry:2",
      symbol: "NDX",
      price: 102,
      volume: 1,
      eventTime: start + 1,
    });
    const telemetry = new TelemetryService(
      gateway as unknown as TelemetryGateway,
      cache,
      clock,
    );
    jest
      .spyOn(cache, "appendTick")
      .mockRejectedValueOnce(new Error("temporary Redis error"));
    const client = new ReplayFeedClient(
      { url, reconnectMs: 100, maxPending: 100, handshakeTimeoutMs: 5000 },
      clock,
      ingestion,
      (input) => telemetry.processIncomingTick(input),
    );
    const engine = new AtrService(
      config,
      cache,
      clock,
      gateway as unknown as TelemetryGateway,
      ingestion,
    );
    try {
      client.start();
      await engine.runCycle();
      expect(engine.metrics.skipped).toBe(1);
      await waitUntil(
        () => client.metrics.accepted === 2 && !ingestion.recovering,
      );
      expect(client.metrics.connections).toBeGreaterThanOrEqual(2);
      const snapshot = await cache.readTicks("NDX", start, start + MINUTE_MS);
      expect(snapshot.ticks.map((t) => t.id)).toEqual(["retry:1", "retry:2"]);
    } finally {
      engine.stop();
      await client.stop();
      await provider.stop();
    }
  });
});
