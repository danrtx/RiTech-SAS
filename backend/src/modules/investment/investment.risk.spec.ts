import {
  Context,
  CreateRecommendation,
  ModelAnalysis,
  instrument,
} from "./investment.types";
import { quality, regularWindow, risk } from "./investment.risk";
import { analysis, fixture } from "./testing/fixtures";
const policy = { quoteAge: 30000, atrAge: 180000, contextAge: 300000 };
describe("Independent investment controls", () => {
  it("distinguishes NDX from the tradable proxy", () => {
    expect(instrument.referenceIndex).toBe("NDX");
    expect(instrument.symbol).toBe("QQQ");
    expect(
      CreateRecommendation.safeParse({ symbol: "NDX", quantity: 1 }).success,
    ).toBe(false);
  });
  it("accepts complete consistent input and permissible decisions", () => {
    const input = fixture();
    expect(quality(input, policy, Date.now())).toEqual([]);
    for (const decision of ["COMPRAR", "VENDER", "MANTENER"])
      expect(risk(input, decision)).toEqual([]);
    expect(Context.safeParse(input.context).success).toBe(true);
  });
  it.each([
    ["stale quote", (i) => (i.market.quotedAt = 0), "COTIZACION_NO_VIGENTE"],
    [
      "future quote",
      (i) => (i.market.quotedAt = Date.now() + 60000),
      "COTIZACION_NO_VIGENTE",
    ],
    ["missing price", (i) => (i.market.price = null), "PRECIO_INVALIDO"],
    ["fake source", (i) => (i.market.simulated = true), "FUENTE_NO_OPERATIVA"],
    [
      "wrong instrument",
      (i) => (i.market.symbol = "NDX"),
      "INSTRUMENTO_INCORRECTO",
    ],
    [
      "no history",
      (i) => (i.market.referencePrice = null),
      "HISTORIAL_INSUFICIENTE",
    ],
    [
      "contradiction",
      (i) => (i.market.referencePrice = 10),
      "DATOS_CONTRADICTORIOS",
    ],
    [
      "ATR warmup",
      (i) => (i.market.atrStatus = "insufficientData"),
      "ATR_INSUFICIENTE",
    ],
    ["stale portfolio", (i) => (i.context.asOf = 0), "CONTEXTO_NO_VIGENTE"],
    ["no portfolio", (i) => (i.context = null), "CONTEXTO_FINANCIERO_AUSENTE"],
    [
      "closed session",
      (i) => (i.market.session = "OUTSIDE_REGULAR_WINDOW"),
      "FUERA_DE_HORARIO_REGULAR",
    ],
  ])("abstains on %s", (_name, mutate, reason) => {
    const input = fixture();
    mutate(input);
    expect(quality(input, policy, Date.now())).toContain(reason);
  });
  it.each([
    ["COMPRAR", (c) => (c.cash = 0), "CAPITAL_INSUFICIENTE"],
    ["VENDER", (c) => (c.position.quantity = 0), "POSICION_INSUFICIENTE"],
    ["COMPRAR", (c) => (c.maxExposure = 650), "EXPOSICION_MAXIMA"],
    ["COMPRAR", (c) => (c.maxInstrumentExposure = 600), "LIMITE_INSTRUMENTO"],
    ["COMPRAR", (c) => (c.maxTradeRisk = 1), "RIESGO_POR_OPERACION"],
    ["COMPRAR", (c) => (c.stopLoss = null), "STOP_LOSS_NO_VALIDO"],
    ["MANTENER", (c) => (c.hedgeActive = false), "COBERTURA_OBLIGATORIA"],
    [
      "MANTENER",
      (c) => (c.allowedHorizons = ["LARGO"]),
      "HORIZONTE_NO_PERMITIDO",
    ],
    ["MANTENER", (c) => (c.tradingEnabled = false), "OPERACION_RESTRINGIDA"],
    ["COMPRAR", (c) => (c.maxAtrPercent = 0.1), "VOLATILIDAD_EXCEDIDA"],
  ])("blocks %s on policy violation", (decision, mutate, reason) => {
    const input = fixture();
    mutate(input.context);
    expect(risk(input, decision)).toContain(reason);
  });
  it("rejects missing context and financial fields supplied by callers", () => {
    const input = fixture();
    input.context = null;
    expect(risk(input, "COMPRAR")).toContain("CONTEXTO_INSUFICIENTE");
    expect(
      CreateRecommendation.safeParse({
        symbol: "QQQ",
        quantity: 1,
        cash: 100000,
      }).success,
    ).toBe(false);
    expect(
      ModelAnalysis.safeParse({ ...analysis, executeOrder: true }).success,
    ).toBe(false);
  });
  it("uses New York daylight saving time and excludes weekends", () => {
    expect(regularWindow(Date.parse("2026-07-06T13:30:00Z"))).toBe(
      "REGULAR_WINDOW",
    );
    expect(regularWindow(Date.parse("2026-11-09T13:30:00Z"))).toBe(
      "OUTSIDE_REGULAR_WINDOW",
    );
    expect(regularWindow(Date.parse("2026-11-08T16:00:00Z"))).toBe(
      "OUTSIDE_REGULAR_WINDOW",
    );
  });
});
