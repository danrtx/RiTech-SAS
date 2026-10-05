import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from "@nestjs/common";
import { AtrConfig } from "./atr.config";
import { aggregate, SymbolAtr } from "./atr.calculator";
import {
  AtrResult,
  MarketClock,
  MINUTE_MS,
  minuteStart,
} from "../market-data/market.types";
import { RedisCacheService } from "../redis-cache/redis-cache.service";
import { TelemetryGateway } from "../telemetry/telemetry.gateway";
import { IngestionState } from "../market-data/ingestion.state";

@Injectable()
export class AtrService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AtrService.name);
  private readonly states = new Map<string, SymbolAtr>();
  private readonly latest = new Map<string, AtrResult>();
  private timer?: ReturnType<typeof setTimeout>;
  private running = false;
  private busy = false;
  private generation = 0;
  readonly metrics = {
    cycles: 0,
    skipped: 0,
    failures: 0,
    resets: 0,
    alerts: 0,
    lastDurationMs: 0,
  };
  constructor(
    private readonly config: AtrConfig,
    private readonly cache: RedisCacheService,
    private readonly clock: MarketClock,
    private readonly gateway: TelemetryGateway,
    private readonly ingestion: IngestionState,
  ) {
    for (const symbol of config.options.symbols)
      this.states.set(symbol, new SymbolAtr(config.options));
  }
  onApplicationBootstrap() {
    this.start();
    void this.runCycle();
  }
  start() {
    if (!this.running) {
      this.running = true;
      this.schedule();
    }
  }
  stop() {
    this.running = false;
    this.generation++;
    if (this.timer) clearTimeout(this.timer);
  }
  onModuleDestroy() {
    this.stop();
  }
  private schedule() {
    if (!this.running) return;
    const now = this.clock.now();
    this.timer = setTimeout(
      () => {
        this.schedule();
        void this.runCycle();
      },
      minuteStart(now) + MINUTE_MS - now,
    );
    this.timer.unref?.();
  }
  snapshot() {
    return {
      results: [...this.latest.values()],
      metrics: { ...this.metrics },
      ingestion: this.ingestion.snapshot(),
      ticks: this.cache.metrics,
    };
  }
  invalidateSymbol(symbol: string, boundary?: number) {
    if (!this.states.has(symbol)) return;
    this.generation++;
    const state = new SymbolAtr(this.config.options);
    state.cursor = boundary;
    this.states.set(symbol, state);
    this.metrics.resets++;
    this.publish({
      symbol,
      minute: minuteStart(this.clock.now()),
      emittedAt: this.clock.now(),
      status: "gap",
      atr: null,
      baseline: null,
      alert: false,
    });
  }
  suspendSymbol(symbol: string) {
    this.generation++;
    this.publish({ symbol, minute: minuteStart(this.clock.now()), emittedAt: this.clock.now(),
      status: 'gap', atr: null, baseline: null, alert: false });
  }
  async rebuildRecovered(until?: number): Promise<void> {
    if (this.busy) throw new Error('ATR snapshot still running');
    for (const symbol of this.config.options.symbols)
      this.states.set(symbol, new SymbolAtr(this.config.options));
    const failures = this.metrics.failures;
    await this.runCycle(true, until);
    if (this.metrics.failures !== failures) throw new Error('recovery_atr_cache_failure');
  }
  private publish(result: AtrResult) {
    this.latest.set(result.symbol, result);
    this.gateway.broadcastAtr(result);
    if (result.alert) this.metrics.alerts++;
  }
  private gap(symbol: string, state: SymbolAtr, until: number) {
    const { missing, reset } = state.checkGap(until);
    if (missing) this.logger.warn({ event: "atrGap", symbol, missing, reset });
    if (reset) this.metrics.resets++;
  }
  async runCycle(suppressAlerts = false, untilOverride?: number): Promise<void> {
    if (this.busy || (this.ingestion.recovering && !suppressAlerts)) {
      this.metrics.skipped++;
      return;
    }
    this.busy = true;
    const generation = this.generation;
    const recoveryVersion = this.ingestion.version;
    const started = this.clock.monotonic();
    const now = this.clock.now();
    const until = minuteStart(Math.min(now, untilOverride ?? now));
    this.metrics.cycles++;
    try {
      await Promise.all(
        this.config.options.symbols.map(async (symbol) => {
          const state = this.states.get(symbol)!;
          let from =
            state.cursor ??
            until - this.config.options.retentionMinutes * MINUTE_MS;
          if (from >= until) return;
          try {
            const snapshot = await this.withTimeout(
              this.cache.readTicks(symbol, from, until),
            );
            if (
              generation !== this.generation ||
              recoveryVersion !== this.ingestion.version
            )
              return;
            if (
              snapshot.coverageStart !== undefined &&
              snapshot.coverageStart > from
            ) {
              this.logger.warn({
                event: "atrCoverageLost",
                symbol,
                from,
                coverageStart: snapshot.coverageStart,
              });
              from = snapshot.coverageStart;
            }
            const candles = aggregate(snapshot.ticks, from, until);
            if (!candles.length)
              this.logger.warn({ event: "atrEmptyCache", symbol });
            let recoveredResult: AtrResult | undefined;
            for (const candle of candles) {
              this.gap(symbol, state, candle.minute);
              const result = state.add(symbol, candle, now);
              if (suppressAlerts) recoveredResult = { ...result, alert: false };
              else this.publish(result);
            }
            if (recoveredResult) this.publish(recoveredResult);
            this.gap(symbol, state, until);
            if (
              !candles.length ||
              (state.lastCandle !== undefined &&
                until - state.lastCandle > MINUTE_MS)
            ) {
              this.publish({
                symbol,
                minute: until,
                emittedAt: now,
                atr: null,
                baseline: null,
                alert: false,
                status:
                  state.lastCandle === undefined || state.gapReset
                    ? "insufficientData"
                    : "gap",
              });
            }
            state.cursor = until;
          } catch {
            if (
              generation !== this.generation ||
              recoveryVersion !== this.ingestion.version
            )
              return;
            this.metrics.failures++;
            this.logger.error({ event: "atrCacheOrCalculationError", symbol });
            this.publish({
              symbol,
              minute: until,
              emittedAt: now,
              atr: null,
              baseline: null,
              alert: false,
              status: "cacheError",
            });
          }
        }),
      );
    } finally {
      this.metrics.lastDurationMs = this.clock.monotonic() - started;
      this.busy = false;
      this.logger.log({ event: "atrCycle", ...this.metrics });
    }
  }
  private async withTimeout<T>(work: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        work,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Cache timeout")),
            this.config.options.readTimeoutMs,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
