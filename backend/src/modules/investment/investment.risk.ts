import { EvaluationInput, MarketSnapshot } from "./investment.types";
export interface FreshnessPolicy {
  quoteAge: number;
  atrAge: number;
  contextAge: number;
}
// A separate, non-operational contract for two consecutive CLOSED one-minute bars.
// The live quote/stop-loss policy is intentionally unchanged.
export const CLOSED_BAR_MAX_AGE_MS = 180000;
export function closedBarQuality(
  input: EvaluationInput,
  policy: FreshnessPolicy,
  now: number,
): string[] {
  const m = input.market;
  const reasons = quality(input, policy, now).filter(
    (reason) =>
      !["COTIZACION_NO_VIGENTE", "CONTEXTO_FINANCIERO_AUSENTE"].includes(
        reason,
      ),
  );
  if (
    m.quoteSource !== "closed_1min_bars" ||
    m.live ||
    m.provider !== "twelvedata" ||
    m.quotedAt === null ||
    !Number.isSafeInteger(m.quotedAt) ||
    m.quotedAt % 60000 !== 0 ||
    now - m.quotedAt < 60000 ||
    now - m.quotedAt >= CLOSED_BAR_MAX_AGE_MS ||
    m.referenceAt !== m.quotedAt - 60000
  ) {
    reasons.push("VELAS_NO_VIGENTES");
  }
  return [...new Set(reasons)];
}
export function quality(
  input: EvaluationInput,
  policy: FreshnessPolicy,
  now: number,
): string[] {
  const { market: m, context: c } = input;
  const reasons: string[] = [];
  const stale = (at: number | null, max: number) =>
    at === null || !Number.isSafeInteger(at) || at > now || now - at > max;
  if (m.symbol !== "QQQ") reasons.push("INSTRUMENTO_INCORRECTO");
  if (m.simulated || !["twelvedata", "alpaca"].includes(m.provider))
    reasons.push("FUENTE_NO_OPERATIVA");
  if (!m.live || stale(m.quotedAt, policy.quoteAge))
    reasons.push("COTIZACION_NO_VIGENTE");
  if (m.session !== "REGULAR_WINDOW") reasons.push("FUERA_DE_HORARIO_REGULAR");
  if (
    m.price === null ||
    !Number.isFinite(m.price) ||
    m.price <= 0 ||
    m.price > 1e8
  )
    reasons.push("PRECIO_INVALIDO");
  if (
    m.atr === null ||
    !Number.isFinite(m.atr) ||
    m.atr <= 0 ||
    m.atrStatus !== "ready" ||
    stale(m.atrAt, policy.atrAge)
  )
    reasons.push("ATR_INSUFICIENTE");
  if (
    m.referencePrice === null ||
    m.referencePrice <= 0 ||
    m.referenceAt === null ||
    m.quotedAt === null ||
    m.referenceAt >= m.quotedAt ||
    m.quotedAt - m.referenceAt > 60000
  )
    reasons.push("HISTORIAL_INSUFICIENTE");
  if (
    m.price &&
    m.referencePrice &&
    Math.abs(m.price / m.referencePrice - 1) > 0.2
  )
    reasons.push("DATOS_CONTRADICTORIOS");
  if (!c) reasons.push("CONTEXTO_FINANCIERO_AUSENTE");
  else {
    if (stale(c.asOf, policy.contextAge)) reasons.push("CONTEXTO_NO_VIGENTE");
    if (c.position.quantity > 0 && c.position.averageEntry <= 0)
      reasons.push("POSICION_INCONSISTENTE");
  }
  return [...new Set(reasons)];
}
export function risk(input: EvaluationInput, decision: string): string[] {
  const { context: c, market: m, quantity: q } = input;
  if (!c || !m.price) return ["CONTEXTO_INSUFICIENTE"];
  if (decision === "ABSTENERSE") return [];
  const reasons: string[] = [];
  if (!c.tradingEnabled || !c.instrumentEnabled)
    reasons.push("OPERACION_RESTRINGIDA");
  if (!c.allowedHorizons.includes(c.horizon))
    reasons.push("HORIZONTE_NO_PERMITIDO");
  if (c.hedgeRequired && !c.hedgeActive) reasons.push("COBERTURA_OBLIGATORIA");
  if (c.stopLoss === null || c.stopLoss <= 0 || c.stopLoss >= m.price)
    reasons.push("STOP_LOSS_NO_VALIDO");
  const current = c.position.quantity * m.price;
  if (
    current + c.otherExposure > c.maxExposure ||
    current > c.maxInstrumentExposure
  )
    reasons.push("EXPOSICION_ACTUAL_EXCEDIDA");
  const atrPercent = ((m.atr || 0) / m.price) * 100;
  if (atrPercent > c.maxAtrPercent) reasons.push("VOLATILIDAD_EXCEDIDA");
  if (decision === "COMPRAR") {
    const cost = q * m.price * 1.001; // Explicit 10 bps cost buffer, never a price prediction.
    if (cost > c.cash) reasons.push("CAPITAL_INSUFICIENTE");
    if (current + c.otherExposure + cost > c.maxExposure)
      reasons.push("EXPOSICION_MAXIMA");
    if (current + cost > c.maxInstrumentExposure)
      reasons.push("LIMITE_INSTRUMENTO");
    if (
      c.stopLoss !== null &&
      q * (m.price - c.stopLoss) + cost * 0.001 > c.maxTradeRisk
    )
      reasons.push("RIESGO_POR_OPERACION");
  }
  if (decision === "VENDER" && c.position.quantity < q)
    reasons.push("POSICION_INSUFICIENTE");
  return [...new Set(reasons)];
}
export function regularWindow(now: number): MarketSnapshot["session"] {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "";
  const minute = Number(get("hour")) * 60 + Number(get("minute"));
  return !["Sat", "Sun"].includes(get("weekday")) &&
    minute >= 570 &&
    minute < 960
    ? "REGULAR_WINDOW"
    : "OUTSIDE_REGULAR_WINDOW";
}

const reasonText: Record<string, string> = {
  INSTRUMENTO_INCORRECTO: "La cotización no corresponde al ETF QQQ.",
  FUENTE_NO_OPERATIVA:
    "La fuente es simulada o no está habilitada para este análisis.",
  COTIZACION_NO_VIGENTE:
    "La cotización no está vigente o no tiene continuidad verificable.",
  FUERA_DE_HORARIO_REGULAR:
    "El mercado está fuera de la ventana regular de negociación.",
  PRECIO_INVALIDO: "No hay un precio válido disponible.",
  ATR_INSUFICIENTE: "No hay suficiente historial reciente para validar el ATR.",
  HISTORIAL_INSUFICIENTE:
    "Falta una referencia histórica reciente y consistente.",
  DATOS_CONTRADICTORIOS:
    "La variación observada requiere verificar la consistencia de los datos.",
  CONTEXTO_FINANCIERO_AUSENTE:
    "El proveedor de mercado no informa capital ni posiciones de una cuenta.",
  CONTEXTO_INSUFICIENTE:
    "No se pueden validar los límites financieros sin datos verificables de cuenta.",
  CONTEXTO_NO_VIGENTE: "El contexto financiero ha vencido.",
  CONTEXTO_MODIFICADO: "El contexto financiero cambió durante la evaluación.",
  POSICION_INCONSISTENTE: "La posición informada es inconsistente.",
  POSICION_INSUFICIENTE:
    "No hay una posición suficiente para la venta evaluada.",
  CAPITAL_INSUFICIENTE:
    "El capital disponible no cubre la cantidad y el margen de costos.",
  OPERACION_RESTRINGIDA: "El instrumento o la operación están restringidos.",
  HORIZONTE_NO_PERMITIDO: "El horizonte no está permitido por la política.",
  COBERTURA_OBLIGATORIA: "No se ha verificado la cobertura obligatoria.",
  STOP_LOSS_NO_VALIDO: "No se ha verificado un stop-loss válido.",
  EXPOSICION_ACTUAL_EXCEDIDA: "La exposición actual supera los límites.",
  EXPOSICION_MAXIMA: "La operación superaría la exposición máxima.",
  LIMITE_INSTRUMENTO: "La operación superaría el límite del instrumento.",
  RIESGO_POR_OPERACION:
    "La pérdida potencial evaluada supera el riesgo permitido.",
  VOLATILIDAD_EXCEDIDA: "El ATR relativo supera la volatilidad permitida.",
  PRECIO_MODIFICADO:
    "El precio cambió significativamente durante la evaluación.",
  EVALUACION_VENCIDA: "Los datos vencieron durante la evaluación.",
};
export function explainReasons(reasons: string[]): string {
  return [
    ...new Set(
      reasons.map(
        (r) =>
          reasonText[r] || "No fue posible validar una condición requerida.",
      ),
    ),
  ].join(" ");
}
