import { parseQqqBars, summarizeQqqCoverage } from "./qqq-history";

const response = () => ({
  meta: {
    symbol: "QQQ",
    interval: "1min",
    exchange_timezone: "America/New_York",
  },
  values: [
    {
      datetime: "2025-01-02 14:30:00",
      open: "100",
      high: "102",
      low: "99",
      close: "101",
    },
  ],
});
describe("QQQ historical import", () => {
  it("quarantines inconsistent OHLC without repairing or using the observation", () => {
    const body = response();
    body.values[0].close = "103";
    const rejected: unknown[] = [];
    expect(
      parseQqqBars(body, "2025-01-01", "2025-01-03 23:59:59", (b) =>
        rejected.push(b),
      ),
    ).toEqual([]);
    expect(rejected).toHaveLength(1);
  });
  it("uses close availability rather than the opening time (no look-ahead)", () => {
    const [bar] = parseQqqBars(response(), "2025-01-01", "2025-01-03 23:59:59");
    expect(bar.eventTimeMs).toBe(Date.parse("2025-01-02T14:31:00Z"));
    expect(bar.price).toBe(101);
  });
  it.each(["NDX", "AAPL"])("rejects a different instrument %s", (symbol) => {
    const body = response();
    body.meta.symbol = symbol;
    expect(() =>
      parseQqqBars(body, "2025-01-01", "2025-01-03 23:59:59"),
    ).toThrow();
  });
  it.each(["0", "NaN", "103"])("rejects invalid OHLC close %s", (close) => {
    const body = response();
    body.values[0].close = close;
    expect(() =>
      parseQqqBars(body, "2025-01-01", "2025-01-03 23:59:59"),
    ).toThrow();
  });
  it("rejects out-of-range dates", () => {
    expect(() =>
      parseQqqBars(response(), "2025-02-01", "2025-03-03 23:59:59"),
    ).toThrow();
  });
  it("counts intraday missing observations without treating overnight closure as missing minutes", () => {
    const times = [
      "2025-01-02T14:31:00Z",
      "2025-01-02T14:34:00Z",
      "2025-01-03T14:31:00Z",
    ].map(Date.parse);
    const coverage = summarizeQqqCoverage(times);
    expect(coverage.withinDateMissingMinutes).toBe(2);
    expect(coverage.observedDates).toBe(2);
    expect(coverage.status).toBe("REQUIRES_EXCHANGE_CALENDAR_REVIEW");
  });
});
