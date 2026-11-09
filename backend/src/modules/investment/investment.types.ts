import { z } from "zod";

export const PROMPT_VERSION = "investment-v1";
export const instrument = Object.freeze({
  symbol: "QQQ",
  name: "Invesco QQQ Trust",
  type: "ETF",
  market: "NASDAQ",
  currency: "USD",
  referenceIndex: "NDX",
  relationship: "ETF proxy del NASDAQ 100; no es el nivel del índice.",
  limitations:
    "Comisiones, tracking error y negociación propia; no representa otros instrumentos apalancados.",
});
export const Decision = z.enum(["COMPRAR", "VENDER", "MANTENER", "ABSTENERSE"]);
const money = z.number().finite().min(0).max(1e12);
export const Context = z
  .object({
    asOf: z.number().int().positive(),
    source: z.string().min(1).max(120),
    cash: money,
    otherExposure: money,
    position: z
      .object({
        quantity: z.number().int().min(0).max(10000000),
        averageEntry: money,
      })
      .strict(),
    maxExposure: money,
    maxInstrumentExposure: money,
    maxTradeRisk: money,
    stopLoss: z.number().finite().positive().max(1e8).nullable(),
    horizon: z.enum(["INTRADIA", "CORTO", "LARGO"]),
    allowedHorizons: z
      .array(z.enum(["INTRADIA", "CORTO", "LARGO"]))
      .min(1)
      .max(3),
    tolerance: z.enum(["BAJA", "MEDIA", "ALTA"]),
    maxAtrPercent: z.number().positive().max(100),
    hedgeRequired: z.boolean(),
    hedgeActive: z.boolean(),
    tradingEnabled: z.boolean(),
    instrumentEnabled: z.boolean(),
  })
  .strict();
export type FinancialContext = z.infer<typeof Context>;
// Only hypothetical balances. Callers cannot claim broker verification or enable orders.
export const SimulationAccount = Context.pick({
  cash: true,
  otherExposure: true,
  position: true,
  maxExposure: true,
  maxInstrumentExposure: true,
  maxTradeRisk: true,
  stopLoss: true,
  maxAtrPercent: true,
})
  .extend({ kind: z.literal("SIMULATED") })
  .strict()
  .superRefine((value, ctx) => {
    if (value.position.quantity > 0 && value.position.averageEntry <= 0)
      ctx.addIssue({
        code: "custom",
        message: "La posición requiere precio promedio positivo",
      });
    if (value.maxInstrumentExposure > value.maxExposure)
      ctx.addIssue({
        code: "custom",
        message: "El límite QQQ no puede superar el límite total",
      });
  });
export type SimulationAccountInput = z.infer<typeof SimulationAccount>;

export const CreateRecommendation = z
  .object({
    symbol: z.literal("QQQ"),
    quantity: z.number().int().positive().max(1000000),
    mode: z.enum(["INTRADAY", "AFTER_CLOSE"]).optional(),
    simulation: SimulationAccount.optional(),
  })
  .strict();
export const Question = z
  .object({ question: z.string().trim().min(3).max(500) })
  .strict();
export const HumanDecision = z
  .object({ decision: z.enum(["SEGUIR", "DESCARTAR", "POSPONER"]) })
  .strict();
const prose = z.string().trim().min(3).max(1200);
export const ModelAnalysis = z
  .object({
    decision: Decision,
    justification: prose,
    risks: z.array(prose).min(1).max(8),
    favorable: prose,
    adverse: prose,
    invalidation: z.array(prose).min(1).max(8),
    uncertainty: z.enum(["BAJA", "MEDIA", "ALTA"]),
    limitations: z.array(prose).min(1).max(8),
  })
  .strict();
export type Analysis = z.infer<typeof ModelAnalysis>;
export const ModelAnswer = z
  .object({ answer: prose, requiresNewEvaluation: z.boolean() })
  .strict();
export interface MarketSnapshot {
  quoteSource?: "closed_1min_bars";
  sessionDateNY?: string;
  symbol: string;
  provider: string;
  simulated: boolean;
  live: boolean;
  price: number | null;
  quotedAt: number | null;
  volume: number | null;
  referencePrice: number | null;
  referenceAt: number | null;
  change: number | null;
  changePercent: number | null;
  atr: number | null;
  atrAt: number | null;
  atrStatus: string;
  atrSource?: "provider_ohlc" | "live_ticks";
  volatility: "BAJA" | "MEDIA" | "ALTA" | "DESCONOCIDA";
  session: "REGULAR_WINDOW" | "OUTSIDE_REGULAR_WINDOW";
}
export interface EvaluationInput {
  context: FinancialContext | null;
  contextVersion: number | null;
  market: MarketSnapshot;
  quantity: number;
}
