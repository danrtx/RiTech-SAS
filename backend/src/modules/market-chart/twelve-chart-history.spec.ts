import { parseHistory } from "./twelve-chart-history";
import {
  regularSession,
  sessionDate,
  sessionTime,
  validDate,
} from "./chart.types";

const now = Date.parse("2026-10-07T14:02:10Z");
const row = {
  datetime: "2026-10-07 14:00:00",
  open: "100",
  high: "103",
  low: "99",
  close: "102",
  volume: "1200",
};
const body = (values: unknown[] = [row]) => ({
  status: "ok",
  meta: {
    symbol: "QQQ",
    currency: "USD",
    interval: "1min",
    exchange: "NASDAQ",
  },
  values,
});

describe("Twelve Data chart history", () => {
  it("uses actual UTC bar time, excludes the forming minute and extended hours", () => {
    const bars = parseHistory(
      body([
        row,
        { ...row, datetime: "2026-10-07 14:02:00" },
        { ...row, datetime: "2026-10-07 12:00:00" },
      ]),
      "QQQ",
      now,
    );
    expect(bars).toEqual([
      {
        startTimeMs: Date.parse("2026-10-07T14:00:00Z"),
        open: 100,
        high: 103,
        low: 99,
        close: 102,
        volume: 1200,
      },
    ]);
    expect(
      parseHistory(body([{ ...row, volume: undefined }]), "QQQ", now)[0].volume,
    ).toBeNull();
  });
  it.each([
    body([{ ...row, high: "90" }]),
    body([{ ...row, open: "Infinity" }]),
    body([{ ...row, volume: "-1" }]),
    body([{ ...row, datetime: "2026-02-30 14:00:00" }]),
    body([row, row]),
    { ...body(), status: "error" },
    { ...body(), meta: { ...body().meta, symbol: "AAPL" } },
    { ...body(), meta: { ...body().meta, currency: "EUR" } },
  ])("rejects invalid or mismatched OHLC without partial import", (value) => {
    expect(() => parseHistory(value, "QQQ", now)).toThrow(
      "chart_history_invalid",
    );
  });
  it("uses the exchange day and accounts for daylight saving, not the server timezone", () => {
    expect(sessionDate(Date.parse("2026-10-08T01:00:00Z"))).toBe("2026-10-07");
    expect(sessionTime(Date.parse("2026-10-07T13:30:00Z"))).toBe("09:30");
    expect(sessionTime(Date.parse("2026-12-07T14:30:00Z"))).toBe("09:30");
    expect(regularSession(Date.parse("2026-10-07T20:00:00Z"))).toBe(false);
    expect(regularSession(Date.parse("2026-10-10T15:00:00Z"))).toBe(false);
    expect(validDate("2026-02-30")).toBe(false);
    expect(validDate("2026-10-07")).toBe(true);
  });
});
