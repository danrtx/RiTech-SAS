import { Logger } from "@nestjs/common";
import { AtrConfig, defaultAtrOptions } from "./atr.config";
import { AtrService } from "./atr.service";
import {
  MarketClock,
  MINUTE_MS,
  TickSnapshot,
} from "../market-data/market.types";
import { IngestionState } from "../market-data/ingestion.state";
import { RedisCacheService } from "../redis-cache/redis-cache.service";
import { TelemetryGateway } from "../telemetry/telemetry.gateway";

const start = Date.UTC(2026, 9, 4, 12);
describe("ATR lifecycle and scheduler", () => {
  let engine: AtrService;
  let cache: { readTicks: jest.Mock; metrics: object };
  let gateway: { broadcastAtr: jest.Mock };
  let ingestion: IngestionState;
  beforeEach(() => {
    jest.useFakeTimers({ now: start + 27000 });
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    cache = {
      readTicks: jest.fn().mockResolvedValue({ ticks: [] }),
      metrics: {},
    };
    gateway = { broadcastAtr: jest.fn() };
    ingestion = new IngestionState();
    engine = new AtrService(
      {
        options: { ...defaultAtrOptions, symbols: ["NDX", "QQQ"] },
      } as AtrConfig,
      cache as unknown as RedisCacheService,
      new MarketClock(),
      gateway as unknown as TelemetryGateway,
      ingestion,
    );
  });
  afterEach(() => {
    engine.stop();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });
  it("aligns to next minute with no drift for slow reads and start is idempotent", async () => {
    const times: number[] = [];
    cache.readTicks.mockImplementation(async () => {
      times.push(Date.now());
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return { ticks: [] };
    });
    engine.start();
    engine.start();
    await jest.advanceTimersByTimeAsync(32000);
    expect(times).toHaveLength(0);
    await jest.advanceTimersByTimeAsync(601000);
    expect(times).toHaveLength(22);
    for (let i = 0; i < 11; i++)
      expect(times[i * 2]).toBe(start + (i + 1) * MINUTE_MS);
  });
  it("guards overlapping calls and times out one symbol without blocking others", async () => {
    let resolve!: (value: TickSnapshot) => void;
    cache.readTicks.mockImplementation((symbol: string) =>
      symbol === "NDX"
        ? new Promise<TickSnapshot>((r) => {
            resolve = r;
          })
        : Promise.resolve({ ticks: [] }),
    );
    const cycle = engine.runCycle();
    await engine.runCycle();
    await jest.advanceTimersByTimeAsync(5000);
    await cycle;
    expect(engine.metrics.skipped).toBe(1);
    expect(engine.metrics.failures).toBe(1);
    expect(gateway.broadcastAtr).toHaveBeenCalledWith(
      expect.objectContaining({ symbol: "QQQ", status: "insufficientData" }),
    );
    const count = gateway.broadcastAtr.mock.calls.length;
    resolve({ ticks: [] });
    await Promise.resolve();
    expect(gateway.broadcastAtr).toHaveBeenCalledTimes(count);
  });
  it("retries read errors without advancing the failed cursor", async () => {
    cache.readTicks.mockRejectedValueOnce(new Error("offline"));
    await engine.runCycle();
    const from = cache.readTicks.mock.calls[0][1];
    await engine.runCycle();
    expect(cache.readTicks.mock.calls[2][1]).toBe(from);
  });
  it("pauses sealing during replay and catches up on next cycle", async () => {
    ingestion.beginRecovery();
    await engine.runCycle();
    expect(cache.readTicks).not.toHaveBeenCalled();
    ingestion.recovered();
    await engine.runCycle();
    expect(cache.readTicks).toHaveBeenCalledTimes(2);
  });
  it("stop invalidates pending reads and removes timers", async () => {
    let resolve!: (value: TickSnapshot) => void;
    cache.readTicks.mockImplementation(
      () =>
        new Promise<TickSnapshot>((r) => {
          resolve = r;
        }),
    );
    engine.start();
    const cycle = engine.runCycle();
    engine.stop();
    resolve({ ticks: [] });
    await jest.advanceTimersByTimeAsync(5000);
    await cycle;
    expect(gateway.broadcastAtr).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });
  it("clock backwards does not replay committed history", async () => {
    await engine.runCycle();
    jest.setSystemTime(start - MINUTE_MS);
    await engine.runCycle();
    expect(cache.readTicks).toHaveBeenCalledTimes(2);
  });
  it("retires a previous signal and ignores in-flight reads when the source loses continuity", async () => {
    let resolve!: (value: TickSnapshot) => void;
    cache.readTicks.mockImplementation((symbol: string) =>
      symbol === "QQQ"
        ? new Promise<TickSnapshot>((r) => {
            resolve = r;
          })
        : Promise.resolve({ ticks: [] }),
    );
    const cycle = engine.runCycle();
    engine.invalidateSymbol("QQQ", start + MINUTE_MS);
    resolve({ ticks: [] });
    await cycle;
    expect(
      engine.snapshot().results.find((r) => r.symbol === "QQQ"),
    ).toMatchObject({ status: "gap", atr: null, alert: false });
    cache.readTicks.mockClear();
    await engine.runCycle();
    expect(cache.readTicks.mock.calls.some((call) => call[0] === "QQQ")).toBe(
      false,
    );
  });
});
