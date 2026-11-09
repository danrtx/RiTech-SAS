import { evaluateRecommendations } from "./recommendation-backtest";
const dataset = {
  provenance: { source: "unit-test-fixture", version: "1", synthetic: true },
  config: { initialCapital: 1000, costBps: 10, slippageBps: 5, maxGapMs: 1000 },
  samples: [100, 100, 110, 90].map((price, i) => ({
    symbol: "QQQ",
    price,
    eventTimeMs: 1000 + i * 1000,
  })),
};
const signals = {
  trainingEndsAt: 1000,
  recommendations: [
    {
      id: "r1",
      generatedAt: 2000,
      dataUntil: 2000,
      decision: "COMPRAR",
      quantity: 1,
      modelVersion: "test",
      promptVersion: "test",
    },
  ],
};
describe("Recorded recommendation evaluation", () => {
  it("executes only at the next observation, charges costs and compares with baseline", () => {
    const result = evaluateRecommendations(
      JSON.stringify(dataset),
      JSON.stringify(signals),
    );
    expect(result.strategy.trades).toBe(1);
    expect(result.strategy.costs).toBeCloseTo(0.165);
    expect(result.strategy.finalEquity).toBeCloseTo(979.835);
    expect(result.baseline.name).toBe("QQQ_BUY_AND_HOLD");
    expect(result.provenance.synthetic).toBe(true);
    expect(result.strategy.maxDrawdownPercent).toBeGreaterThan(0);
  });
  it("rejects look-ahead leakage", () => {
    expect(() =>
      evaluateRecommendations(
        JSON.stringify(dataset),
        JSON.stringify({
          ...signals,
          recommendations: [{ ...signals.recommendations[0], dataUntil: 3000 }],
        }),
      ),
    ).toThrow();
  });
  it("rejects NDX levels, overlapping evaluation and absent history", () => {
    expect(() =>
      evaluateRecommendations(
        JSON.stringify({
          ...dataset,
          samples: dataset.samples.map((s) => ({ ...s, symbol: "NDX" })),
        }),
        JSON.stringify(signals),
      ),
    ).toThrow("QQQ");
    expect(() =>
      evaluateRecommendations(
        JSON.stringify(dataset),
        JSON.stringify({ ...signals, trainingEndsAt: 3000 }),
      ),
    ).toThrow();
  });
});
