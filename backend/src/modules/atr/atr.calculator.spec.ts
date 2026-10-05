import { readFileSync } from "fs";
import { join } from "path";
import {
  aggregate,
  SymbolAtr,
  VolatilityDetector,
  WilderAtr,
} from "./atr.calculator";
import { AtrOptions, defaultAtrOptions, validateOptions } from "./atr.config";
import {
  CachedTick,
  Candle,
  MINUTE_MS,
  validateTick,
} from "../market-data/market.types";

const start = Date.UTC(2026, 9, 4, 12);
const options = (changes: Partial<AtrOptions> = {}) =>
  validateOptions({ ...defaultAtrOptions, symbols: ["NDX"], ...changes });
const candle = (minute: number, low = 10, high = 12, close = 11): Candle => ({
  minute: start + minute * MINUTE_MS,
  open: low,
  low,
  high,
  close,
});

describe("Wilder ATR and candles", () => {
  it("matches all 47 pandas ATR values within 1e-6", () => {
    const csv = readFileSync(
      join(
        __dirname,
        "../../../../packages/atr_engine/test/fixtures/atr_reference.csv",
      ),
      "utf8",
    );
    const calculator = new WilderAtr(14);
    let compared = 0;
    for (const row of csv.trim().split(/\r?\n/).slice(1)) {
      const [time, open, high, low, close, , reference] = row.split(",");
      const actual = calculator.add({
        minute: Date.parse(time),
        open: +open,
        high: +high,
        low: +low,
        close: +close,
      });
      if (!reference) expect(actual).toBeNull();
      else {
        expect(Math.abs(actual! - +reference)).toBeLessThanOrEqual(1e-6);
        compared++;
      }
    }
    expect(compared).toBe(47);
  });
  it("first TR, seed, price gaps, recurrence and period one", () => {
    const atr = new WilderAtr(3);
    expect(atr.add(candle(0))).toBeNull();
    expect(atr.add(candle(1, 15, 17, 16))).toBeNull();
    expect(atr.add(candle(2))).toBeCloseTo(14 / 3, 12);
    expect(atr.add(candle(3))).toBeCloseTo(((14 / 3) * 2 + 2) / 3, 12);
    expect(new WilderAtr(1).add(candle(0))).toBe(2);
  });
  it("builds OHLC at UTC boundaries, excluding open and empty minutes", () => {
    const ticks = [10, 14, 9, 12, 20].map((price, i): CachedTick => ({
      id: `${i}`,
      symbol: "NDX",
      price,
      volume: 1,
      eventTime: start + i * 15000,
      receivedAt: start + 2 * MINUTE_MS,
      sequence: i,
    }));
    expect(aggregate(ticks, start, start + MINUTE_MS)).toEqual([
      { minute: start, open: 10, high: 14, low: 9, close: 12 },
    ]);
    expect(aggregate([], start, start + MINUTE_MS)).toEqual([]);
  });
  it.each([2, 3])("handles %i missing minutes with K=2", (missing) => {
    const state = new SymbolAtr(options({ period: 2, maxGapMinutes: 2 }));
    expect(state.add("NDX", candle(0), start).status).toBe("insufficientData");
    expect(state.checkGap(start + (missing + 1) * MINUTE_MS).reset).toBe(
      missing > 2,
    );
    const result = state.add("NDX", candle(missing + 1, 20, 22, 21), start);
    expect(result.atr).toBe(missing > 2 ? null : 6.5);
  });
  it("resets only once per long gap and clears baseline", () => {
    const state = new SymbolAtr(
      options({ period: 1, baselineWindow: 1, maxGapMinutes: 1 }),
    );
    state.add("NDX", candle(0), start);
    expect(state.add("NDX", candle(1), start).baseline).toBe(2);
    expect(state.checkGap(start + 5 * MINUTE_MS).reset).toBe(true);
    expect(state.checkGap(start + 6 * MINUTE_MS).reset).toBe(false);
    expect(state.add("NDX", candle(6), start).baseline).toBeNull();
  });
});
describe("volatility", () => {
  it.each([
    [14.999999, false],
    [15, true],
    [15.000001, true],
  ])("threshold %p => %p", (value, expected) => {
    expect(new VolatilityDetector(options()).exceeds(value as number, 10)).toBe(
      expected,
    );
  });
  it("relative epsilon at small and large scales, including strict epsilon zero", () => {
    for (const scale of [1e-9, 1, 1e9]) {
      const detector = new VolatilityDetector(options());
      expect(detector.exceeds(15 * scale * (1 - 5e-13), 10 * scale)).toBe(true);
      expect(detector.exceeds(15 * scale * (1 - 2e-12), 10 * scale)).toBe(
        false,
      );
    }
    expect(
      new VolatilityDetector(options({ epsilon: 0 })).exceeds(15 - 1e-13, 10),
    ).toBe(false);
    expect(
      new VolatilityDetector(options({ threshold: 2 })).exceeds(15, 10),
    ).toBe(false);
  });
  it("uses previous ATRs only, applies cooldown and handles zero base", () => {
    const detector = new VolatilityDetector(
      options({ baselineWindow: 1, cooldownMinutes: 2 }),
    );
    expect(detector.add(10, start).baseline).toBeNull();
    expect(detector.add(15, start + MINUTE_MS)).toEqual({
      baseline: 10,
      alert: true,
    });
    expect(detector.add(30, start + 2 * MINUTE_MS).alert).toBe(false);
    expect(detector.add(60, start + 3 * MINUTE_MS).alert).toBe(true);
    expect(detector.exceeds(0, 0)).toBe(false);
    expect(detector.exceeds(1, 0)).toBe(true);
    expect(() => detector.exceeds(1, Number.MAX_VALUE)).toThrow();
  });
});
describe("typed inputs", () => {
  const tick = {
    id: "t1",
    symbol: "NDX",
    price: 100,
    volume: 1,
    eventTime: start,
    receivedAt: start,
  };
  it.each([null, 0, -1, NaN, Infinity, -Infinity])(
    "rejects price %p",
    (price) => {
      expect(validateTick({ ...tick, price }, start, ["NDX"])).toBe(
        "invalidPrice",
      );
    },
  );
  it.each([null, NaN, Infinity, -1, start + 1, "invalid", 1.2])(
    "rejects event timestamp %p",
    (eventTime) => {
      expect(validateTick({ ...tick, eventTime }, start, ["NDX"])).toBe(
        "invalidTimestamp",
      );
    },
  );
  it("validates configuration and remaining tick fields", () => {
    expect(validateTick(null, start, ["NDX"])).toBe("invalidTick");
    expect(validateTick({ ...tick, symbol: "X" }, start, ["NDX"])).toBe(
      "unknownSymbol",
    );
    expect(validateTick({ ...tick, volume: -1 }, start, ["NDX"])).toBe(
      "invalidVolume",
    );
    expect(validateTick(tick, start, ["NDX"])).toBeNull();
    expect(() => options({ period: 0 })).toThrow();
    expect(() => options({ retentionMinutes: 1 })).toThrow();
    expect(() => options({ threshold: Infinity })).toThrow();
  });
});
