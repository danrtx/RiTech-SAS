import { Injectable } from "@nestjs/common";
import { PriceAnalysisService } from "../market-data/analysis/price-analysis.service";
import { AtrService } from "../atr/atr.service";
import { MarketSnapshot } from "./investment.types";
import { regularWindow } from "./investment.risk";
import { InvestmentHistoryAtr } from "./investment-history-atr";

@Injectable()
export class InvestmentMarket {
  constructor(
    private readonly prices: PriceAnalysisService,
    private readonly atr: AtrService,
    private readonly historical: InvestmentHistoryAtr,
  ) {}
  async closingSnapshot(): Promise<MarketSnapshot | undefined> {
    await this.historical.refresh();
    const source = this.historical.closingSession();
    const current = this.snapshot();
    if (!source || current.provider !== "twelvedata" || current.simulated)
      return undefined;
    const [reference, last] = source.bars;
    if (!reference || !last) return undefined;
    const atr = source.indicator?.atr ?? null;
    return {
      ...current,
      live: false,
      quoteSource: "closed_1min_bars",
      sessionDateNY: source.date,
      price: last.close,
      quotedAt: last.startTimeMs,
      volume: last.volume,
      referencePrice: reference.close,
      referenceAt: reference.startTimeMs,
      change: last.close - reference.close,
      changePercent: (last.close / reference.close - 1) * 100,
      atr,
      atrAt: source.indicator?.minute ?? null,
      atrStatus: source.indicator?.status ?? "insufficientData",
      atrSource: "provider_ohlc",
      volatility:
        atr === null
          ? "DESCONOCIDA"
          : atr / last.close >= 0.01
            ? "ALTA"
            : atr / last.close >= 0.003
              ? "MEDIA"
              : "BAJA",
    };
  }
  /** Informational analysis only: never marks historical prices as live ticks. */
  closedBarSnapshot(): MarketSnapshot | undefined {
    const current = this.snapshot();
    if (current.provider !== "twelvedata" || current.simulated)
      return undefined;
    const bars = this.historical.recentBars();
    const [reference, last] = bars;
    if (!reference || !last) return undefined;
    return {
      ...current,
      quoteSource: "closed_1min_bars",
      live: false,
      price: last.close,
      quotedAt: last.startTimeMs,
      referencePrice: reference.close,
      referenceAt: reference.startTimeMs,
      volume: last.volume,
      change: last.close - reference.close,
      changePercent: (last.close / reference.close - 1) * 100,
      volatility:
        current.atr === null
          ? "DESCONOCIDA"
          : current.atr / last.close >= 0.01
            ? "ALTA"
            : current.atr / last.close >= 0.003
              ? "MEDIA"
              : "BAJA",
    };
  }
  snapshot(): MarketSnapshot {
    const history = this.prices.getHistory(1000);
    const last = history.samples[history.samples.length - 1];
    const reference =
      last &&
      [...history.samples]
        .reverse()
        .find((s) => s.eventTimeMs <= last.eventTimeMs - 10000);
    const liveIndicator = this.atr
      .snapshot()
      .results.find((r) => r.symbol === "QQQ");
    const seed =
      history.marketReference.provider === "twelvedata" &&
      !history.marketReference.simulated
        ? this.historical.snapshot()
        : undefined;
    const useHistory =
      seed?.status === "ready" &&
      (liveIndicator?.status !== "ready" || seed.minute > liveIndicator.minute);
    const indicator = useHistory ? seed : liveIndicator;
    const atr = indicator?.atr ?? null;
    const percent = last && atr !== null ? (atr / last.price) * 100 : null;
    return {
      symbol: history.symbol,
      provider: history.marketReference.provider,
      simulated: history.marketReference.simulated,
      live: this.prices.getStatus().fresh,
      price: last?.price ?? null,
      quotedAt: last?.eventTimeMs ?? null,
      volume: last?.kind === "trade" ? last.volume : null,
      referencePrice: reference?.price ?? null,
      referenceAt: reference?.eventTimeMs ?? null,
      change: last && reference ? last.price - reference.price : null,
      changePercent:
        last && reference ? (last.price / reference.price - 1) * 100 : null,
      atr,
      atrAt: indicator?.minute ?? null,
      atrStatus: indicator?.status || "insufficientData",
      atrSource: useHistory ? "provider_ohlc" : "live_ticks",
      volatility:
        percent === null
          ? "DESCONOCIDA"
          : percent >= 1
            ? "ALTA"
            : percent >= 0.3
              ? "MEDIA"
              : "BAJA",
      session: regularWindow(Date.now()),
    };
  }
}
