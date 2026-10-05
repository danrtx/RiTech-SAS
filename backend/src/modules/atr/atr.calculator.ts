import { AtrOptions } from "./atr.config";
import {
  AtrResult,
  CachedTick,
  Candle,
  MINUTE_MS,
  minuteStart,
} from "../market-data/market.types";

export function aggregate(
  ticks: readonly CachedTick[],
  from: number,
  until: number,
): Candle[] {
  const candles: Candle[] = [];
  for (const tick of ticks) {
    if (tick.eventTime < from || tick.eventTime >= until) continue;
    const minute = minuteStart(tick.eventTime);
    const last = candles[candles.length - 1];
    if (!last || last.minute !== minute) {
      candles.push({
        minute,
        open: tick.price,
        high: tick.price,
        low: tick.price,
        close: tick.price,
      });
    } else {
      last.high = Math.max(last.high, tick.price);
      last.low = Math.min(last.low, tick.price);
      last.close = tick.price;
    }
  }
  return candles;
}

export class WilderAtr {
  private previousClose?: number;
  private count = 0;
  private seed = 0;
  private value: number | null = null;
  constructor(readonly period: number) {
    if (!Number.isSafeInteger(period) || period < 1)
      throw new Error("Invalid ATR period");
  }
  copy(): WilderAtr {
    return Object.assign(new WilderAtr(this.period), this);
  }
  add(candle: Candle): number | null {
    if (
      ![candle.high, candle.low, candle.open, candle.close].every(
        (p) => Number.isFinite(p) && p > 0,
      ) ||
      candle.high < Math.max(candle.low, candle.open, candle.close) ||
      candle.low > Math.min(candle.open, candle.close)
    )
      throw new Error("Invalid candle");
    const tr =
      this.previousClose === undefined
        ? candle.high - candle.low
        : Math.max(
            candle.high - candle.low,
            Math.abs(candle.high - this.previousClose),
            Math.abs(candle.low - this.previousClose),
          );
    const seed = this.value === null ? this.seed + tr / this.period : this.seed;
    const value =
      this.value === null
        ? this.count + 1 >= this.period
          ? seed
          : null
        : this.value * ((this.period - 1) / this.period) + tr / this.period;
    if (!Number.isFinite(seed) || (value !== null && !Number.isFinite(value)))
      throw new Error("Non-finite ATR");
    this.previousClose = candle.close;
    this.seed = seed;
    this.count++;
    this.value = value;
    return value;
  }
}

export class VolatilityDetector {
  private history: number[] = [];
  private lastAlert?: number;
  constructor(readonly options: AtrOptions) {}
  copy(): VolatilityDetector {
    const copy = new VolatilityDetector(this.options);
    copy.history = [...this.history];
    copy.lastAlert = this.lastAlert;
    return copy;
  }
  exceeds(actual: number, baseline: number): boolean {
    if (![actual, baseline].every((v) => Number.isFinite(v) && v >= 0))
      throw new Error("Invalid ATR value");
    if (baseline === 0) return actual > 0;
    const target = this.options.threshold * baseline;
    if (!Number.isFinite(target)) throw new Error("Non-finite threshold");
    return (
      actual >= target ||
      target - actual <=
        this.options.epsilon * Math.max(Math.abs(actual), Math.abs(target))
    );
  }
  add(
    value: number,
    minute: number,
  ): { baseline: number | null; alert: boolean } {
    if (!Number.isFinite(value) || value < 0)
      throw new Error("Invalid ATR value");
    const baseline =
      this.history.length === this.options.baselineWindow
        ? this.history.reduce(
            (sum, v) => sum + v / this.options.baselineWindow,
            0,
          )
        : null;
    const alert =
      baseline !== null &&
      this.exceeds(value, baseline) &&
      (this.lastAlert === undefined ||
        minute - this.lastAlert >= this.options.cooldownMinutes * MINUTE_MS);
    if (alert) this.lastAlert = minute;
    this.history.push(value);
    if (this.history.length > this.options.baselineWindow) this.history.shift();
    return { baseline, alert };
  }
}

export class SymbolAtr {
  calculator: WilderAtr;
  detector: VolatilityDetector;
  cursor?: number;
  lastCandle?: number;
  gapReset = false;
  constructor(readonly options: AtrOptions) {
    this.calculator = new WilderAtr(options.period);
    this.detector = new VolatilityDetector(options);
  }
  checkGap(next: number): { missing: number; reset: boolean } {
    const missing =
      this.lastCandle === undefined
        ? 0
        : Math.max(0, (next - this.lastCandle) / MINUTE_MS - 1);
    const reset = missing > this.options.maxGapMinutes && !this.gapReset;
    if (reset) {
      this.calculator = new WilderAtr(this.options.period);
      this.detector = new VolatilityDetector(this.options);
      this.gapReset = true;
    }
    return { missing, reset };
  }
  add(symbol: string, candle: Candle, emittedAt: number): AtrResult {
    const calculator = this.calculator.copy();
    const detector = this.detector.copy();
    const atr = calculator.add(candle);
    const detection =
      atr === null
        ? { baseline: null, alert: false }
        : detector.add(atr, candle.minute);
    this.calculator = calculator;
    this.detector = detector;
    this.lastCandle = candle.minute;
    this.gapReset = false;
    this.cursor = candle.minute + MINUTE_MS;
    return {
      symbol,
      minute: candle.minute,
      emittedAt,
      atr,
      ...detection,
      status:
        atr === null
          ? "insufficientData"
          : detection.baseline === null
            ? "baselineWarmingUp"
            : "ready",
    };
  }
}
