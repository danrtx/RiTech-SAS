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
