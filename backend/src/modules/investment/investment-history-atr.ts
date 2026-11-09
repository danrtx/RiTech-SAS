import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AtrConfig, AtrOptions } from "../atr/atr.config";
import { SymbolAtr } from "../atr/atr.calculator";
import { AtrResult, MINUTE_MS } from "../market-data/market.types";
import { MarketDataConfig } from "../market-data/market-data.config";
import { HistoricalBar } from "../market-chart/chart.types";
import { sessionDate, sessionTime } from "../market-chart/chart.types";
import { fetchChartHistory } from "../market-chart/twelve-chart-history";
import { regularWindow } from "./investment.risk";

/** OHLC is an independent analytical source, never manufactured live ticks. */
export function historicalAtr(
  bars: readonly HistoricalBar[],
  options: AtrOptions,
  now: number,
): AtrResult | undefined {
  let state = new SymbolAtr(options);
  let result: AtrResult | undefined;
  let previous: number | undefined;
  for (const bar of bars) {
    if (
      !Number.isSafeInteger(bar.startTimeMs) ||
      bar.startTimeMs % MINUTE_MS !== 0 ||
      bar.startTimeMs < 0 ||
      (previous !== undefined && bar.startTimeMs <= previous)
    )
      throw new Error("investment_history_invalid_order");
    if (bar.startTimeMs + MINUTE_MS > now) continue;
    // Even small missing intervals cannot be advertised as continuous history.
    // Overnight/weekend boundaries also require a new seed.
    if (previous !== undefined && bar.startTimeMs - previous !== MINUTE_MS)
      state = new SymbolAtr(options);
    result = state.add(
      "QQQ",
      {
        minute: bar.startTimeMs,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
      },
      now,
    );
    previous = bar.startTimeMs;
  }
  return result;
}

@Injectable()
export class InvestmentHistoryAtr
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(InvestmentHistoryAtr.name);
  private latest?: AtrResult;
  private closedBars: HistoricalBar[] = [];
  private sourceBars: HistoricalBar[] = [];
  private timer?: NodeJS.Timeout;
  private request?: AbortController;
  private stopped = false;
  private busy = false;
  constructor(
    private readonly settings: ConfigService,
    private readonly atr: AtrConfig,
  ) {}

  snapshot(): AtrResult | undefined {
    return this.latest && { ...this.latest };
  }

  recentBars(): HistoricalBar[] {
    return this.closedBars.map((bar) => ({ ...bar }));
  }

  closingSession(now = Date.now()) {
    const today = sessionDate(now);
    const completed = this.sourceBars.filter((bar) => {
      const date = sessionDate(bar.startTimeMs);
      return date < today || (date === today && sessionTime(now) >= "16:00");
    });
    const last = completed[completed.length - 1];
    // Do not silently label an incomplete day as the official regular close.
    if (!last || sessionTime(last.startTimeMs) !== "15:59") return undefined;
    const date = sessionDate(last.startTimeMs);
    const bars = completed.filter(
      (bar) => sessionDate(bar.startTimeMs) === date,
    );
    return {
      date,
      bars: bars.slice(-2).map((bar) => ({ ...bar })),
      indicator: historicalAtr(bars, this.atr.options, now),
    };
  }

  async onApplicationBootstrap() {
    const config = this.settings.get<MarketDataConfig>("marketData");
    if (
      !config?.enabled ||
      config.provider !== "twelvedata" ||
      config.feed !== "realtime" ||
      config.symbol !== "QQQ" ||
      !config.credentials?.apiKey
    )
      return;
    await this.refresh();
    if (this.stopped) return;
    this.timer = setInterval(() => {
      if (regularWindow(Date.now()) === "REGULAR_WINDOW") void this.refresh();
    }, MINUTE_MS);
    this.timer.unref();
  }

  async refresh(): Promise<void> {
    const config = this.settings.get<MarketDataConfig>("marketData");
    if (
      this.stopped ||
      this.busy ||
      !config?.enabled ||
      config.provider !== "twelvedata" ||
      config.feed !== "realtime" ||
      config.symbol !== "QQQ" ||
      !config.credentials?.apiKey
    )
      return;
    this.busy = true;
    const request = (this.request = new AbortController());
    const timeout = setTimeout(() => request.abort(), 15000);
    try {
      const bars = await fetchChartHistory(
        "QQQ",
        config.credentials.apiKey,
        request.signal,
      );
      if (this.stopped || request.signal.aborted) return;
      const result = historicalAtr(bars, this.atr.options, Date.now());
      // Empty/partial responses invalidate an older seed instead of hiding a gap.
      this.latest = result;
      this.closedBars = bars.slice(-2).map((bar) => ({ ...bar }));
      this.sourceBars = bars.map((bar) => ({ ...bar }));
      this.logger.log({
        event: "investment_atr_history_loaded",
        bars: bars.length,
        minute: result?.minute ?? null,
        status: result?.status ?? "insufficientData",
      });
    } catch {
      // No provider messages or URLs: they may include credentials.
      // A previous successful result keeps its ORIGINAL minute and expires normally.
      if (!this.stopped) this.logger.warn("investment_atr_history_unavailable");
    } finally {
      clearTimeout(timeout);
      this.request = undefined;
      this.busy = false;
    }
  }

  onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.request?.abort();
  }
}
