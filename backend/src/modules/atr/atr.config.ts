import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

export interface AtrOptions {
  symbols: readonly string[];
  period: number;
  threshold: number;
  baselineWindow: number;
  maxGapMinutes: number;
  cooldownMinutes: number;
  epsilon: number;
  retentionMinutes: number;
  maxTicksPerSymbol: number;
  readTimeoutMs: number;
  prefix: string;
}
export const defaultAtrOptions: AtrOptions = {
  symbols: ["NDX", "QQQ", "AAPL", "NVDA"],
  period: 14,
  threshold: 1.5,
  baselineWindow: 20,
  maxGapMinutes: 5,
  cooldownMinutes: 0,
  epsilon: 1e-12,
  retentionMinutes: 1440,
  maxTicksPerSymbol: 100_000,
  readTimeoutMs: 5000,
  prefix: "ritech:market:v1",
};
export function validateOptions(options: AtrOptions): AtrOptions {
  for (const key of [
    "period",
    "baselineWindow",
    "retentionMinutes",
    "maxTicksPerSymbol",
    "readTimeoutMs",
  ] as const) {
    if (!Number.isSafeInteger(options[key]) || options[key] < 1)
      throw new Error(`Invalid ATR ${key}`);
  }
  for (const key of ["maxGapMinutes", "cooldownMinutes"] as const) {
    if (!Number.isSafeInteger(options[key]) || options[key] < 0)
      throw new Error(`Invalid ATR ${key}`);
  }
  if (
    !options.symbols.length ||
    options.symbols.some((s) => !/^[A-Z0-9._-]{1,32}$/.test(s)) ||
    !Number.isFinite(options.threshold) ||
    options.threshold <= 0 ||
    !Number.isFinite(options.epsilon) ||
    options.epsilon < 0 ||
    options.epsilon >= 1 ||
    options.retentionMinutes < options.period + options.baselineWindow ||
    !/^[a-zA-Z0-9:_-]+$/.test(options.prefix)
  )
    throw new Error("Invalid ATR options");
  return Object.freeze({
    ...options,
    symbols: Object.freeze([...new Set(options.symbols)]),
  });
}
@Injectable()
export class AtrConfig {
  readonly options: AtrOptions;
  constructor(config: ConfigService) {
    const number = (name: string, fallback: number) =>
      Number(config.get<string | number>(name, fallback));
    this.options = validateOptions({
      symbols: config
        .get<string>("ATR_SYMBOLS", defaultAtrOptions.symbols.join(","))
        .split(",")
        .map((s) => s.trim().toUpperCase()),
      period: number("ATR_PERIOD", 14),
      threshold: number("ATR_THRESHOLD", 1.5),
      baselineWindow: number("ATR_BASELINE_WINDOW", 20),
      maxGapMinutes: number("ATR_MAX_GAP_MINUTES", 5),
      cooldownMinutes: number("ATR_COOLDOWN_MINUTES", 0),
      epsilon: number("ATR_EPSILON", 1e-12),
      retentionMinutes: number("TICK_RETENTION_MINUTES", 1440),
      maxTicksPerSymbol: number("TICK_MAX_PER_SYMBOL", 100_000),
      readTimeoutMs: number("ATR_READ_TIMEOUT_MS", 5000),
      prefix: config.get<string>("TICK_KEY_PREFIX", defaultAtrOptions.prefix),
    });
  }
}
