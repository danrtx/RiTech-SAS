import { ConfigService } from "@nestjs/config";
import { Subject } from "rxjs";
import { MarketDataBatch } from "../market-data/market-data.protocol";
import { MarketDataWsClient } from "../market-data/market-data-ws.client";
import { parseMarketDataConfig } from "../market-data/market-data.config";
import { TwelveDataAdapter } from "../market-data/adapters/twelve-data.adapter";
import { TelemetryGateway } from "../telemetry/telemetry.gateway";
import { ChartStore } from "./chart.store";
import { MarketChartService } from "./market-chart.service";

describe("Chart capture and session API", () => {
  const eventTime = Date.parse("2026-10-07T15:30:00Z");
  const config = parseMarketDataConfig({
    MARKET_DATA_ENABLED: "true",
    MARKET_DATA_PROVIDER: "twelvedata",
    TWELVE_DATA_API_KEY: "test-only",
  });
  let service: MarketChartService;
  let batches: Subject<MarketDataBatch>;
  let store: { record: jest.Mock; dates: jest.Mock; day: jest.Mock };
  let telemetry: { broadcastChartCandle: jest.Mock };
  const price = {
    T: "price" as const,
    event: "price",
    symbol: "QQQ",
    currency: "USD",
    exchange: "NASDAQ",
    timestamp: eventTime / 1000,
    price: 103,
  };
  beforeEach(() => {
    batches = new Subject();
    store = {
      record: jest
        .fn()
        .mockResolvedValue({ symbol: "QQQ", date: "2026-10-07" }),
      dates: jest.fn().mockResolvedValue(["2026-10-06"]),
      day: jest.fn().mockResolvedValue([]),
    };
    telemetry = { broadcastChartCandle: jest.fn() };
    service = new MarketChartService(
      new ConfigService({ marketData: config, CHART_HISTORY_ENABLED: "false" }),
      {
        data$: batches.asObservable(),
        getStatus: () => ({ state: "LIVE" }),
      } as unknown as MarketDataWsClient,
      store as unknown as ChartStore,
      telemetry as unknown as TelemetryGateway,
    );
    service.onModuleInit();
  });
  afterEach(async () => {
    await service.onModuleDestroy();
    jest.restoreAllMocks();
  });
  it("archives delayed prices independently of the strict decision pipeline and emits only after persistence", async () => {
    let commit!: () => void;
    store.record.mockImplementation(
      () =>
        new Promise((resolve) => {
          commit = () => resolve({ symbol: "QQQ" });
        }),
    );
    expect(
      new TwelveDataAdapter(config).normalize(price, eventTime + 45_000),
    ).toEqual({ ok: false, reason: "stale" });
    batches.next({
      messages: [price],
      receivedAtMs: eventTime + 45_000,
      receivedAtMonotonicMs: 1,
    });
    expect(store.record).toHaveBeenCalledTimes(1);
    expect(telemetry.broadcastChartCandle).not.toHaveBeenCalled();
    commit();
    await service.onModuleDestroy();
    expect(telemetry.broadcastChartCandle).toHaveBeenCalledWith({
      symbol: "QQQ",
    });
  });
  it("rejects invalid prices, other symbols, future events and after-hours observations", async () => {
    const invalid = [
      { ...price, price: -1 },
      { ...price, symbol: "AAPL" },
      { ...price, timestamp: eventTime / 1000 + 60 },
      { ...price, timestamp: Date.parse("2026-10-07T12:00:00Z") / 1000 },
    ];
    batches.next({
      messages: invalid,
      receivedAtMs: eventTime,
      receivedAtMonotonicMs: 1,
    });
    await service.onModuleDestroy();
    expect(store.record).not.toHaveBeenCalled();
  });
  it("falls back to the last stored session only for an omitted date and validates queries", async () => {
    jest.spyOn(Date, "now").mockReturnValue(eventTime);
    expect((await service.snapshot()).date).toBe("2026-10-06");
    expect((await service.snapshot("QQQ", "2026-10-07")).date).toBe(
      "2026-10-07",
    );
    expect((await service.snapshot("QQQ", "2026-10-06")).session).toBe(
      "historical",
    );
    await expect(service.snapshot("NDX")).rejects.toThrow();
    await expect(service.snapshot("QQQ", "2026-02-30")).rejects.toThrow();
    await expect(service.snapshot("QQQ", "2026-10-08")).rejects.toThrow();
  });
});
