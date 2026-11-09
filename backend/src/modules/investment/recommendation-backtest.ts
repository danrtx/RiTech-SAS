import { z } from "zod";
import { createHash } from "node:crypto";
import { parseDataset } from "../backtesting/dataset";
const Signals = z
  .object({
    trainingEndsAt: z.number().int().positive(),
    recommendations: z
      .array(
        z
          .object({
            id: z.string().min(1),
            generatedAt: z.number().int().positive(),
            dataUntil: z.number().int().positive(),
            decision: z.enum(["COMPRAR", "VENDER", "MANTENER", "ABSTENERSE"]),
            quantity: z.number().int().positive(),
            promptVersion: z.string().min(1),
            modelVersion: z.string().min(1),
          })
          .strict(),
      )
      .max(100000),
  })
  .strict();

/** Evaluates recorded recommendations only. Never queries a model with future bars. */
export function evaluateRecommendations(
  rawDataset: string,
  rawSignals: string,
) {
  const dataset = parseDataset(rawDataset);
  const signals = Signals.parse(JSON.parse(rawSignals));
  if (dataset.samples[0].symbol !== "QQQ")
    throw new Error("Use QQQ prices, never NDX levels as ETF prices");
  if (!dataset.samples.some((s) => s.eventTimeMs <= signals.trainingEndsAt))
    throw new Error("Missing separate training interval");
  const samples = dataset.samples.filter(
    (s) => s.eventTimeMs > signals.trainingEndsAt,
  );
  if (samples.length < 2) throw new Error("Insufficient evaluation data");
  const ids = new Set<string>();
  let last = signals.trainingEndsAt;
  for (const r of signals.recommendations) {
    if (
      ids.has(r.id) ||
      r.dataUntil > r.generatedAt ||
      r.generatedAt <= last ||
      r.generatedAt >= samples[samples.length - 1].eventTimeMs
    )
      throw new Error(
        "Duplicate, unordered, future-leaking or out-of-window recommendation",
      );
    ids.add(r.id);
    last = r.generatedAt;
  }
  const fee = (dataset.config.costBps + dataset.config.slippageBps) / 10000;
  function run(baseline: boolean) {
    let cash = dataset.config.initialCapital;
    let units = 0;
    let cursor = 0;
    let costs = 0;
    let trades = 0;
    let peak = cash;
    let drawdown = 0;
    let exposed = 0;
    let previous = cash;
    const returns: number[] = [];
    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i];
      if (
        i &&
        sample.eventTimeMs - samples[i - 1].eventTimeMs >
          dataset.config.maxGapMs
      )
        throw new Error("Historical data gap exceeds declared tolerance");
      if (baseline && i === 0) {
        units = Math.floor(cash / (sample.price * (1 + fee)));
        const cost = units * sample.price * fee;
        cash -= units * sample.price + cost;
        costs += cost;
        if (units) trades++;
      }
      if (!baseline) {
        // Only signals generated strictly before this observed price can act here.
        while (
          cursor < signals.recommendations.length &&
          signals.recommendations[cursor].generatedAt < sample.eventTimeMs
        ) {
          const r = signals.recommendations[cursor++];
          const gross = r.quantity * sample.price;
          const cost = gross * fee;
          if (r.decision === "COMPRAR" && gross + cost <= cash) {
            cash -= gross + cost;
            units += r.quantity;
            costs += cost;
            trades++;
          }
          if (r.decision === "VENDER" && r.quantity <= units) {
            cash += gross - cost;
            units -= r.quantity;
            costs += cost;
            trades++;
          }
        }
      }
      const equity = cash + units * sample.price;
      peak = Math.max(peak, equity);
      drawdown = Math.max(drawdown, (peak - equity) / peak);
      exposed += (units * sample.price) / equity;
      if (i) returns.push(equity / previous - 1);
      previous = equity;
    }
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const volatility = Math.sqrt(
      returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / returns.length,
    );
    return {
      returnPercent: (previous / dataset.config.initialCapital - 1) * 100,
      volatilityPerObservation: volatility,
      maxDrawdownPercent: drawdown * 100,
      meanExposurePercent: (exposed / samples.length) * 100,
      trades,
      costs,
      returnToVolatility: volatility ? mean / volatility : null,
      finalEquity: previous,
    };
  }
  return {
    provenance: dataset.provenance,
    datasetSha256: createHash("sha256").update(rawDataset).digest("hex"),
    signalsSha256: createHash("sha256").update(rawSignals).digest("hex"),
    trainingEndsAt: signals.trainingEndsAt,
    evaluationFrom: samples[0].eventTimeMs,
    evaluationTo: samples[samples.length - 1].eventTimeMs,
    strategy: run(false),
    baseline: { name: "QQQ_BUY_AND_HOLD", ...run(true) },
    limitations: [
      "Evaluación de señales registradas, sin generación retrospectiva de Gemini.",
      "Costos y slippage constantes declarados; sin simulación de profundidad ni fills IOC.",
      "No certifica rentabilidad futura ni elimina conocimiento futuro del entrenamiento del modelo.",
      "Volatilidad por observación, no anualizada; requiere evidencia externa de procedencia y tiempo de las señales.",
    ],
  };
}
