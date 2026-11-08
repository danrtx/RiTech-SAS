import {
  BadRequestException,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Subscription } from "rxjs";
import { MarketDataWsClient } from "../market-data/market-data-ws.client";
import { MarketDataConfig } from "../market-data/market-data.config";
import { TwelveDataAdapter } from "../market-data/adapters/twelve-data.adapter";
import { TelemetryGateway } from "../telemetry/telemetry.gateway";
import { ChartStore } from "./chart.store";
import {
  CHART_ZONE,
  ChartObservation,
  regularSession,
  sessionDate,
  sessionTime,
  validDate,
} from "./chart.types";
import { fetchChartHistory } from "./twelve-chart-history";

@Injectable()
export class MarketChartService
  implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(MarketChartService.name);
  private readonly config: MarketDataConfig;
  private readonly subscriptions = new Subscription();
  private queue: ChartObservation[] = [];
  private worker?: Promise<void>;
  private timer?: NodeJS.Timeout;
  private historyTask?: Promise<void>;
  private readonly shutdown = new AbortController();
  private stopping = false;
  private lastEventMs: number | null = null;
  private lastReceivedMs: number | null = null;
  private readonly metrics = {
    recorded: 0,
    rejected: 0,
    dropped: 0,
    writeErrors: 0,
  };
  private readonly history = {
    state: "pending",
    lastSuccessMs: null as number | null,
    barsImported: 0,
  };

  constructor(
    private readonly settings: ConfigService,
    private readonly client: MarketDataWsClient,
    private readonly store: ChartStore,
    private readonly telemetry: TelemetryGateway,
  ) {
    this.config = settings.getOrThrow<MarketDataConfig>("marketData");
  }

  private get enabled() {
    return (
      this.config.enabled &&
      this.config.provider === "twelvedata" &&
      this.config.feed === "realtime"
    );
  }

  onModuleInit() {
    if (!this.enabled) return;
    // Delayed observations can draw a historical chart, but remain excluded from live decisions.
    const adapter = new TwelveDataAdapter({
      ...this.config,
      maxTickAgeMs: 86_400_000,
    });
    this.subscriptions.add(
      this.client.data$.subscribe((batch) => {
        for (const message of batch.messages) {
          const result = adapter.normalize(message, batch.receivedAtMs);
          if (!result.ok || !regularSession(result.tick.eventTimeMs)) {
            this.metrics.rejected++;
            continue;
          }
          if (this.queue.length >= 5000) {
            this.metrics.dropped++;
            continue;
          }
          const tick = result.tick;
          this.queue.push({
            id: tick.eventId.replace(/^td:/, ""),
            symbol: tick.symbol,
            price: tick.price,
            eventTimeMs: tick.eventTimeMs,
            receivedAtMs: tick.receivedAtMs,
          });
        }
        this.drain();
      }),
    );
  }

  onApplicationBootstrap() {
    if (
      !this.enabled ||
      this.settings.get<string>("CHART_HISTORY_ENABLED") === "false"
    ) {
      this.history.state = "disabled";
      return;
    }
    void this.refreshHistory();
    // One request per five minutes, independently of the number of dashboard clients.
    this.timer = setInterval(() => void this.refreshHistory(), 300_000);
    this.timer.unref();
  }

  private drain() {
    if (this.worker) return;
    this.worker = this.persist().finally(() => {
      this.worker = undefined;
    });
  }

  private async persist() {
    while (this.queue.length) {
      const observation = this.queue.shift()!;
      let recorded = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const candle = await this.store.record(observation);
          this.lastEventMs = Math.max(
            this.lastEventMs ?? 0,
            observation.eventTimeMs,
          );
          this.lastReceivedMs = observation.receivedAtMs;
          this.metrics.recorded++;
          if (candle) this.telemetry.broadcastChartCandle(candle);
          recorded = true;
          break;
        } catch {
          this.metrics.writeErrors++;
          if (attempt < 2)
            await new Promise((resolve) =>
              setTimeout(resolve, 100 * (attempt + 1)),
            );
        }
      }
      if (!recorded) {
        this.metrics.dropped++;
        this.logger.error("chart_observation_persistence_failed");
      }
    }
  }

  refreshHistory(): Promise<void> {
    if (this.historyTask) return this.historyTask;
    if (this.stopping) return Promise.resolve();
    this.historyTask = (async () => {
      this.history.state = "loading";
      try {
        const key = this.config.credentials?.apiKey;
        if (!key) throw new Error();
        const bars = await fetchChartHistory(
          this.config.symbol,
          key,
          AbortSignal.any([this.shutdown.signal, AbortSignal.timeout(15_000)]),
        );
        if (this.stopping) return;
        await this.store.importBars(this.config.symbol, bars);
        this.history.state = "ready";
        this.history.lastSuccessMs = Date.now();
        this.history.barsImported = bars.length;
      } catch {
        this.history.state = "unavailable";
        if (!this.stopping) this.logger.warn("chart_history_unavailable");
      }
    })().finally(() => {
      this.historyTask = undefined;
    });
    return this.historyTask;
  }

  async snapshot(symbol?: string, requestedDate?: string) {
    if (symbol && symbol !== "QQQ")
      throw new BadRequestException(
        "Solo QQQ está disponible como referencia del Nasdaq 100",
      );
    if (requestedDate && !validDate(requestedDate))
      throw new BadRequestException("Fecha inválida: usar YYYY-MM-DD");
    const now = Date.now();
    const today = sessionDate(now);
    if (requestedDate && requestedDate > today)
      throw new BadRequestException("La fecha no puede estar en el futuro");
    const dates = await this.store.dates("QQQ");
    const date =
      requestedDate ?? (dates.includes(today) ? today : (dates[0] ?? today));
    const candles = await this.store.day("QQQ", date);
    const first = candles[0];
    const last = candles.at(-1);
    return {
      symbol: "QQQ",
      provider: "twelvedata",
      targetIndex: "NDX",
      instrumentType: "ETF_PROXY",
      timeZone: CHART_ZONE,
      interval: "1min",
      date,
      today,
      availableDates: dates,
      session:
        date < today
          ? "historical"
          : regularSession(now)
            ? "regular_hours"
            : "outside_regular_hours",
      // Session is a clock window, not an exchange holiday/early-close calendar.
      sessionTime: sessionTime(now),
      generatedAtMs: now,
      stream: {
        connected: this.enabled && this.client.getStatus().state === "LIVE",
        lastEventMs: this.lastEventMs,
        lastReceivedMs: this.lastReceivedMs,
        fresh:
          this.lastEventMs !== null &&
          now - this.lastEventMs <= 15_000 &&
          now - this.lastEventMs >= -2000,
      },
      storage: {
        ...this.metrics,
        queueDepth: this.queue.length,
        history: { ...this.history },
      },
      summary:
        first && last
          ? {
              open: first.open,
              high: Math.max(...candles.map((c) => c.high)),
              low: Math.min(...candles.map((c) => c.low)),
              close: last.close,
              change: last.close - first.open,
              changePercent: (last.close / first.open - 1) * 100,
              bars: candles.length,
              firstBarMs: first.startTimeMs,
              lastBarMs: last.startTimeMs,
            }
          : null,
      candles,
    };
  }

  async onModuleDestroy() {
    this.stopping = true;
    this.subscriptions.unsubscribe();
    if (this.timer) clearInterval(this.timer);
    this.shutdown.abort();
    await this.historyTask;
    await this.worker;
  }
}
