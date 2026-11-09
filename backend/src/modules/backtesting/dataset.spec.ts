import { inspectDataset, parseDataset } from "./dataset";

const data = () => ({
  provenance: { source: "test fixture", version: "1", synthetic: true },
  config: { initialCapital: 1000, costBps: 0, slippageBps: 0, maxGapMs: 2000 },
  samples: [
    { symbol: "NDX", price: 100, eventTimeMs: Date.UTC(2024, 0, 1) },
    { symbol: "NDX", price: 99, eventTimeMs: Date.UTC(2024, 0, 1) + 1000 },
  ],
});

describe("historical dataset reception", () => {
  it("retains provider quality blockers when the cleaned dataset is replayed offline", () => {
    const value = data();
    const provenance = { ...value.provenance, excludedInvalidBars: 15 };
    expect(
      inspectDataset(JSON.stringify({ ...value, provenance })).report.blockers,
    ).toContain("PROVIDER_OHLC_INCONSISTENCIES");
    expect(() =>
      parseDataset(
        JSON.stringify({
          ...value,
          provenance: { ...provenance, excludedInvalidBars: -1 },
        }),
      ),
    ).toThrow();
  });
  it.each([
    null,
    [],
    {},
    { provenance: {} },
    { ...data(), config: null },
    { ...data(), samples: null },
  ])("rejects invalid external structure %j", (value) =>
    expect(() => parseDataset(JSON.stringify(value))).toThrow(),
  );
  it("rejects malformed JSON and empty provenance", () => {
    expect(() => parseDataset("{")).toThrow("valid JSON");
    const value = data();
    value.provenance.source = "  ";
    expect(() => parseDataset(JSON.stringify(value))).toThrow("source");
  });
  it("rejects invalid costs and mixed instruments", () => {
    const value = data();
    value.config.costBps = 10000;
    expect(() => parseDataset(JSON.stringify(value))).toThrow("costBps");
    value.config.costBps = 0;
    value.samples[1].symbol = "QQQ";
    expect(() => parseDataset(JSON.stringify(value))).toThrow("mixed symbols");
  });
  it("rejects duplicate timestamps, invalid dates and nonpositive prices", () => {
    const value = data();
    value.samples[1].eventTimeMs = value.samples[0].eventTimeMs;
    expect(() => parseDataset(JSON.stringify(value))).toThrow(
      "strictly increasing",
    );
    value.samples[1].eventTimeMs = Number.MAX_SAFE_INTEGER;
    expect(() => parseDataset(JSON.stringify(value))).toThrow("UTC epoch");
    value.samples[1].price = 0;
    expect(() => parseDataset(JSON.stringify(value))).toThrow("price");
  });
  it("does not certify synthetic data or a short historical series", () => {
    const { report } = inspectDataset(JSON.stringify(data()));
    expect(report.blockers).toEqual(["SYNTHETIC_DATA", "LESS_THAN_24_MONTHS"]);
    expect(report.historicalAcceptance).toBe("NOT_DEMONSTRATED");
    expect(report.sha256).toMatch(/^[a-f0-9]{64}$/);
  });
  it("does not treat two distant dates as sufficient intraday coverage", () => {
    const value = data();
    value.provenance.synthetic = false;
    value.samples[1].eventTimeMs = Date.UTC(2026, 0, 1);
    const { report } = inspectDataset(JSON.stringify(value));
    expect(report.spans24Months).toBe(true);
    expect(report.blockers).toContain("NO_INTRADAY_OBSERVATIONS");
    expect(report.discontinuities).toBe(1);
  });
  it("requires independent review even with 24-month endpoints and intraday samples", () => {
    const value = data();
    value.provenance.synthetic = false;
    value.samples.push({
      symbol: "NDX",
      price: 110,
      eventTimeMs: Date.UTC(2026, 0, 1),
    });
    const { report } = inspectDataset(JSON.stringify(value));
    expect(report.historicalAcceptance).toBe(
      "REQUIRES_SOURCE_AND_COVERAGE_REVIEW",
    );
    expect(report.discontinuities).toBe(1);
    expect(report.gapExamples).toHaveLength(1);
  });
  it("accepts the selected QQQ instrument without certifying coverage", () => {
    const value = data();
    value.samples = Array.from({ length: 30 }, (_, i) => ({
      symbol: "QQQ",
      price: 100,
      eventTimeMs: i * 5000,
    }));
    const { report } = inspectDataset(JSON.stringify(value));
    expect(report.instrument).toBe("QQQ_ETF_NOT_NDX_INDEX");
    expect(report.blockers).not.toContain("INSTRUMENT_REQUIRES_APPROVAL");
    expect(report.blockers).toContain("LESS_THAN_24_MONTHS");
    expect(report.discontinuities).toBe(29);
    expect(report.gapExamples).toHaveLength(20);
  });
});
