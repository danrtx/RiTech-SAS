import { InvestmentMarket } from "./investment.market";
import { PriceAnalysisService } from "../market-data/analysis/price-analysis.service";
import { AtrService } from "../atr/atr.service";
import { InvestmentHistoryAtr } from "./investment-history-atr";
const emptyHistory = { snapshot: () => undefined } as unknown as InvestmentHistoryAtr;
describe("Reuse the configured market and ATR sources", () => {
  it("preserves provider timestamps, separates QQQ and NDX, and does not invent volume", () => {
    const now = Date.now();
    const prices = {
      getHistory: () => ({
        symbol: "QQQ",
        marketReference: { provider: "twelvedata", simulated: false },
        samples: [
          { price: 99, eventTimeMs: now - 10000, kind: "price" },
          { price: 100, eventTimeMs: now, kind: "price" },
        ],
      }),
      getStatus: () => ({ fresh: true }),
    };
    const atr = {
      snapshot: () => ({
        results: [
          { symbol: "QQQ", atr: 0.5, minute: now - 60000, status: "ready" },
          { symbol: "NDX", atr: 100, minute: now - 60000, status: "ready" },
        ],
      }),
    };
    const value = new InvestmentMarket(
      prices as unknown as PriceAnalysisService,
      atr as unknown as AtrService,
      emptyHistory,
    ).snapshot();
    expect(value).toMatchObject({
      price: 100,
      atr: 0.5,
      quotedAt: now,
      volume: null,
      provider: "twelvedata",
      referencePrice: 99,
      volatility: "MEDIA",
    });
  });
  it("keeps absent prices and indicators null", () => {
    const prices = {
      getHistory: () => ({
        symbol: "QQQ",
        marketReference: { provider: "twelvedata", simulated: false },
        samples: [],
      }),
      getStatus: () => ({ fresh: false }),
    };
    const atr = { snapshot: () => ({ results: [] }) };
    expect(
      new InvestmentMarket(
        prices as unknown as PriceAnalysisService,
        atr as unknown as AtrService,
        emptyHistory,
      ).snapshot(),
    ).toMatchObject({
      price: null,
      atr: null,
      live: false,
      volatility: "DESCONOCIDA",
    });
  });
});
