import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";
import { AtrConfig } from "../atr/atr.config";
import {
  AppendResult,
  CachedTick,
  MarketClock,
  MINUTE_MS,
  minuteStart,
  Tick,
  TickRejection,
  TickSnapshot,
  validateTick,
} from "../market-data/market.types";
import { APPEND_TICK, READ_TICKS } from "./tick-cache.scripts";

@Injectable()
export class RedisCacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisCacheService.name);
  private client: Redis;
  readonly metrics = {
    accepted: 0,
    discarded: {} as Partial<Record<TickRejection, number>>,
  };
  constructor(
    private readonly configService: ConfigService,
    private readonly config: AtrConfig,
    private readonly clock: MarketClock,
  ) {}
  onModuleInit() {
    const host = this.configService.get<string>("REDIS_HOST", "localhost");
    const port = Number(this.configService.get<number>("REDIS_PORT", 6379));
    const password = this.configService.get<string>("REDIS_PASS");
    this.client = new Redis({
      host,
      port,
      password: password || undefined,
      commandTimeout: this.config.options.readTimeoutMs,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: (times) => Math.min(times * 100, 1500),
    });
    this.client.on("ready", () => this.logger.log("Redis ready"));
    this.client.on("error", () => this.logger.error("Redis connection error"));
  }
  getClient(): Redis {
    return this.client;
  }
  keys(symbol: string): [string, string, string] {
    if (!this.config.options.symbols.includes(symbol))
      throw new Error("Unknown symbol");
    const prefix = `${this.config.options.prefix}:{${symbol}}`;
    return [`${prefix}:index`, `${prefix}:data`, `${prefix}:meta`];
  }
  private reject(reason: TickRejection): AppendResult {
    this.metrics.discarded[reason] = (this.metrics.discarded[reason] ?? 0) + 1;
    if (
      this.metrics.discarded[reason] === 1 ||
      this.metrics.discarded[reason]! % 1000 === 0
    ) {
      this.logger.warn({
        event: "tickDiscarded",
        reason,
        count: this.metrics.discarded[reason],
      });
    }
    return { accepted: false, reason };
  }
  async appendTick(value: unknown): Promise<AppendResult> {
    const now = this.clock.now();
    const invalid = validateTick(value, now, this.config.options.symbols);
    if (invalid) return this.reject(invalid);
    const tick = value as Tick;
    const options = this.config.options;
    const result = await this.client.eval(
      APPEND_TICK,
      3,
      ...this.keys(tick.symbol),
      JSON.stringify(tick),
      now - options.retentionMinutes * MINUTE_MS,
      options.maxTicksPerSymbol,
      options.retentionMinutes * 60 + 60,
    );
    if (result !== "accepted") {
      if (
        ["duplicate", "expired", "late", "outOfOrder"].includes(String(result))
      )
        return this.reject(result as TickRejection);
      throw new Error("Invalid Redis append response");
    }
    this.metrics.accepted++;
    return { accepted: true };
  }
  async readTicks(
    symbol: string,
    from: number,
    until: number,
  ): Promise<TickSnapshot> {
    const options = this.config.options;
    const now = this.clock.now();
    if (
      !Number.isSafeInteger(from) ||
      !Number.isSafeInteger(until) ||
      until !== minuteStart(until) ||
      from >= until ||
      until > minuteStart(now)
    )
      throw new Error("Invalid tick interval");
    const raw = await this.client.eval(
      READ_TICKS,
      3,
      ...this.keys(symbol),
      from,
      until,
      now - options.retentionMinutes * MINUTE_MS,
      options.maxTicksPerSymbol,
      options.retentionMinutes * 60 + 60,
    );
    if (!Array.isArray(raw)) throw new Error("Invalid Redis snapshot");
    const coverageStart = raw[0] === "" ? undefined : Number(raw[0]);
    const ticks: CachedTick[] = [];
    for (const item of raw.slice(1)) {
      let value: unknown;
      try {
        const envelope = JSON.parse(String(item)) as {
          sequence: number;
          tick: unknown;
        };
        value =
          typeof envelope.tick === "object" && envelope.tick !== null
            ? { ...envelope.tick, sequence: envelope.sequence }
            : null;
      } catch {
        this.reject("invalidTick");
        continue;
      }
      const invalid = validateTick(value, now, options.symbols);
      if (invalid) {
        this.reject(invalid);
        continue;
      }
      const tick = value as CachedTick;
      if (tick.symbol !== symbol || !Number.isSafeInteger(tick.sequence)) {
        this.reject("invalidTick");
        continue;
      }
      ticks.push(tick);
    }
    ticks.sort((a, b) => a.eventTime - b.eventTime || a.sequence - b.sequence);
    return { ticks, coverageStart };
  }
  onModuleDestroy() {
    this.client?.disconnect();
  }
}
