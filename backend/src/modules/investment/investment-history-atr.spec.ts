import { ConfigService } from "@nestjs/config";
import { AtrConfig, defaultAtrOptions } from "../atr/atr.config";
import { HistoricalBar } from "../market-chart/chart.types";
import { fetchChartHistory } from "../market-chart/twelve-chart-history";
import { historicalAtr, InvestmentHistoryAtr } from "./investment-history-atr";
import { InvestmentMarket } from "./investment.market";
import { PriceAnalysisService } from "../market-data/analysis/price-analysis.service";
import { AtrService } from "../atr/atr.service";
import { quality } from "./investment.risk";
import { fixture } from "./testing/fixtures";

jest.mock("../market-chart/twelve-chart-history", () => ({
  fetchChartHistory: jest.fn(),
}));
const fetchHistory = jest.mocked(fetchChartHistory);
const now = Date.parse("2026-11-09T16:00:10Z");
const start = Date.parse("2026-11-09T15:20:00Z");
const bars = (length = 40): HistoricalBar[] =>
  Array.from({ length }, (_, i) => ({
    startTimeMs: start + i * 60000,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 10,
  }));
const config = new ConfigService({
  marketData: {
    enabled: true,
    provider: "twelvedata",
    feed: "realtime",
    symbol: "QQQ",
    credentials: { apiKey: "TEST_ONLY" },
  },
});
const atrConfig = new AtrConfig(new ConfigService());

describe("Historical ATR seed for the investment agent", () => {
  it("selects a completed session and its ATR instead of mixing it with today's forming session", async () => {
    const closeStart = Date.parse("2026-11-09T20:20:00Z");
    const closed = bars().map((bar, i) => ({
      ...bar,
      startTimeMs: closeStart + i * 60000,
    }));
    const morning = bars().map((bar, i) => ({
      ...bar,
      startTimeMs: Date.parse("2026-11-10T14:30:00Z") + i * 60000,
    }));
    jest.setSystemTime(Date.parse("2026-11-10T16:00:00Z"));
    fetchHistory.mockResolvedValue([...closed, ...morning]);
    const service = new InvestmentHistoryAtr(config, atrConfig);
    await service.refresh();
    const review = service.closingSession()!;
    expect(review.date).toBe("2026-11-09");
    expect(review.indicator?.status).toBe("ready");
    expect(review.indicator?.minute).toBe(Date.parse("2026-11-09T20:59:00Z"));
    expect(review.bars.map((b) => b.startTimeMs)).toEqual([
      Date.parse("2026-11-09T20:58:00Z"),
      Date.parse("2026-11-09T20:59:00Z"),
    ]);
    fetchHistory.mockResolvedValue(closed.slice(0, -1));
    await service.refresh();
    expect(service.closingSession()).toBeUndefined();
  });
  it("does not overlap requests or publish a result after shutdown", async () => {
    let resolve!: (value: HistoricalBar[]) => void;
    fetchHistory.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const service = new InvestmentHistoryAtr(config, atrConfig);
    const pending = service.refresh();
    await service.refresh();
    expect(fetchHistory).toHaveBeenCalledTimes(1);
    const signal = fetchHistory.mock.calls[0][2];
    service.onModuleDestroy();
    expect(signal.aborted).toBe(true);
    resolve(bars());
    await pending;
    expect(service.snapshot()).toBeUndefined();
  });
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(now);
    fetchHistory.mockReset();
  });
  afterEach(() => jest.useRealTimers());
  it("warms ATR and baseline immediately from closed OHLC, keeping provider time", () => {
    const result = historicalAtr(bars(), defaultAtrOptions, now)!;
    expect(result.atr).toBeCloseTo(2, 12);
    expect(result.baseline).toBeCloseTo(2, 12);
    expect(result).toMatchObject({
      status: "ready",
      minute: start + 39 * 60000,
    });
    expect(historicalAtr(bars(33), defaultAtrOptions, now)?.status).toBe(
      "baselineWarmingUp",
    );
    expect(historicalAtr(bars(34), defaultAtrOptions, now)?.status).toBe(
      "ready",
    );
  });
  it("does not use forming/future bars or cross missing intervals", () => {
    expect(historicalAtr(bars(45), defaultAtrOptions, now)?.minute).toBe(
      start + 39 * 60000,
    );
    expect(
      historicalAtr(
        bars().filter((_, i) => i !== 30),
        defaultAtrOptions,
        now,
      )?.status,
    ).toBe("insufficientData");
    const weekend = [
      ...bars(),
      ...bars(1).map((b) => ({
        ...b,
        startTimeMs: b.startTimeMs + 3 * 86400000,
      })),
    ];
    expect(
      historicalAtr(weekend, defaultAtrOptions, now + 3 * 86400000)?.status,
    ).toBe("insufficientData");
    expect(() =>
      historicalAtr([bars()[0], bars()[0]], defaultAtrOptions, now),
    ).toThrow();
    expect(() =>
      historicalAtr([{ ...bars()[0], high: 90 }], defaultAtrOptions, now),
    ).toThrow();
  });
  it("loads once at startup, refreshes during session, and stops cleanly", async () => {
    fetchHistory.mockResolvedValue(bars());
    const service = new InvestmentHistoryAtr(config, atrConfig);
    await service.onApplicationBootstrap();
    expect(service.snapshot()?.status).toBe("ready");
    await jest.advanceTimersByTimeAsync(60000);
    expect(fetchHistory).toHaveBeenCalledTimes(2);
    service.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(60000);
    expect(fetchHistory).toHaveBeenCalledTimes(2);
  });
  it("never fetches for a simulated feed or replaces the original timestamp on failure", async () => {
    const disabled = new InvestmentHistoryAtr(
      new ConfigService({
        marketData: {
          enabled: true,
          provider: "twelvedata",
          feed: "mock",
          symbol: "QQQ",
          credentials: { apiKey: "TEST_ONLY" },
        },
      }),
      atrConfig,
    );
    await disabled.onApplicationBootstrap();
    expect(fetchHistory).not.toHaveBeenCalled();
    const service = new InvestmentHistoryAtr(config, atrConfig);
    fetchHistory
      .mockResolvedValueOnce(bars())
      .mockRejectedValueOnce(new Error("provider unavailable"));
    await service.refresh();
    const minute = service.snapshot()?.minute;
    jest.setSystemTime(now + 600000);
    await service.refresh();
    expect(service.snapshot()?.minute).toBe(minute);
    fetchHistory.mockResolvedValueOnce([]);
    await service.refresh();
    expect(service.snapshot()).toBeUndefined();
  });
  it("uses the seed without inventing ticks, and still rejects stale data or missing live quotes", async () => {
    fetchHistory.mockResolvedValue(bars());
    const service = new InvestmentHistoryAtr(config, atrConfig);
    await service.refresh();
    const prices = {
      getHistory: () => ({
        symbol: "QQQ",
        marketReference: {
          provider: "twelvedata",
          simulated: false,
        },
        samples: [
          { price: 100, eventTimeMs: Date.now() - 10000, kind: "price" },
          { price: 100, eventTimeMs: Date.now(), kind: "price" },
        ],
      }),
      getStatus: () => ({ fresh: true }),
    };
    const live = { snapshot: () => ({ results: [] }) };
    const market = new InvestmentMarket(
      prices as unknown as PriceAnalysisService,
      live as unknown as AtrService,
      service,
    );
    const policy = { quoteAge: 30000, atrAge: 180000, contextAge: 300000 };
    expect(market.snapshot().atr).toBeCloseTo(2, 12);
    expect(market.snapshot()).toMatchObject({
      atrSource: "provider_ohlc",
      atrAt: start + 39 * 60000,
    });
    expect(
      quality({ ...fixture(), market: market.snapshot() }, policy, now),
    ).toEqual([]);
    jest.setSystemTime(now + 180000);
    expect(
      quality({ ...fixture(), market: market.snapshot() }, policy, Date.now()),
    ).toContain("ATR_INSUFICIENTE");
    jest.setSystemTime(now);
    prices.getStatus = () => ({ fresh: false });
    expect(
      quality({ ...fixture(), market: market.snapshot() }, policy, now),
    ).toContain("COTIZACION_NO_VIGENTE");
    const newer = historicalAtr(bars(), defaultAtrOptions, now)!;
    const readyLive = { snapshot: () => ({ results: [newer] }) };
    expect(
      new InvestmentMarket(
        prices as unknown as PriceAnalysisService,
        readyLive as unknown as AtrService,
        service,
      ).snapshot().atrSource,
    ).toBe("live_ticks");
  });
});
