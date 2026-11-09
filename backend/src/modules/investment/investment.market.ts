import { Injectable } from "@nestjs/common";
import { PriceAnalysisService } from "../market-data/analysis/price-analysis.service";
import { AtrService } from "../atr/atr.service";
import { MarketSnapshot } from "./investment.types";
import { regularWindow } from "./investment.risk";

@Injectable()
export class InvestmentMarket {
  constructor(
    private readonly prices: PriceAnalysisService,
    private readonly atr: AtrService,
  ) {}
  snapshot(): MarketSnapshot {
    const history = this.prices.getHistory(1000);
    const last = history.samples[history.samples.length - 1];
    const reference =
      last &&
      [...history.samples]
        .reverse()
        .find((s) => s.eventTimeMs <= last.eventTimeMs - 10000);
    const indicator = this.atr
      .snapshot()
      .results.find((r) => r.symbol === "QQQ");
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
