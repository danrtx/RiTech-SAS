import {
  Context,
  EvaluationInput,
  FinancialContext,
  SimulationAccount,
  SimulationAccountInput,
} from "./investment.types";
import { explainReasons, risk } from "./investment.risk";

export function simulationContext(
  value: SimulationAccountInput,
  now: number,
): FinancialContext {
  const { kind, ...account } = SimulationAccount.parse(value);
  if (kind !== 'SIMULATED') throw new Error('Only simulated accounts are supported');
  return Context.parse({
    ...account,
    asOf: now,
    source: "USER_DECLARED_SIMULATION",
    horizon: "INTRADIA",
    allowedHorizons: ["INTRADIA"],
    tolerance: "MEDIA",
    hedgeRequired: false,
    hedgeActive: false,
    tradingEnabled: true,
    instrumentEnabled: true,
  });
}

/** Explain a hypothetical decision without ever upgrading it to an operative order. */
export function simulatedResult(
  result: Record<string, unknown>,
  input: EvaluationInput,
) {
  const validation = result.riskValidation as
    { reasons?: string[] } | undefined;
  const informational = [
    "SOLO_ANALISIS_VELAS_CERRADAS",
    "SOLO_REVISION_AL_CIERRE",
  ];
  const common = (validation?.reasons || []).filter(
    (reason) => !informational.includes(reason),
  );
  // Closed-bar fallback carries the rejected tick's reasons; its own status validates bars.
  const marketReasons =
    result.status === "ANALISIS_INFORMATIVO"
      ? common.filter(
          (reason) =>
            ![
              "COTIZACION_NO_VIGENTE",
              "HISTORIAL_INSUFICIENTE",
              "PRECIO_INVALIDO",
            ].includes(reason),
        )
      : common;
  if (
    !["READY", "ANALISIS_INFORMATIVO", "ANALISIS_AL_CIERRE"].includes(
      String(result.status),
    ) ||
    Number(result.validUntil) <= Date.now()
  )
    marketReasons.push("EVALUACION_VENCIDA");
  const proposed = String(
    result.modelDecision ?? result.decision ?? "ABSTENERSE",
  );
  const reasons = [...new Set([...marketReasons, ...risk(input, proposed)])];
  // A failed BUY budget must not incorrectly block a SELL with available holdings.
  const financialReasons = new Set([
    "OPERACION_RESTRINGIDA",
    "HORIZONTE_NO_PERMITIDO",
    "COBERTURA_OBLIGATORIA",
    "STOP_LOSS_NO_VALIDO",
    "EXPOSICION_ACTUAL_EXCEDIDA",
    "VOLATILIDAD_EXCEDIDA",
    "CAPITAL_INSUFICIENTE",
    "EXPOSICION_MAXIMA",
    "LIMITE_INSTRUMENTO",
    "RIESGO_POR_OPERACION",
    "POSICION_INSUFICIENTE",
  ]);
  const candidates = ["COMPRAR", "VENDER", "MANTENER"].map((decision) => {
    const blocked = [
      ...new Set([
        ...marketReasons.filter((reason) => !financialReasons.has(reason)),
        ...risk(input, decision),
      ]),
    ];
    return {
      decision,
      allowed: blocked.length === 0,
      reasons: blocked,
      explanation: blocked.length
        ? explainReasons(blocked)
        : "Cumple los límites del escenario simulado; no es una orden.",
    };
  });
  const price = input.market.price;
  return {
    ...result,
    accountMode: "SIMULATED",
    modelDecision: proposed,
    simulationDecision: reasons.length ? "ABSTENERSE" : proposed,
    decision: "ABSTENERSE",
    operable: false,
    orderStatus: "NO_ORDER_REQUESTED",
    simulationValidation: {
      passed: reasons.length === 0,
      reasons,
      explanation: reasons.length
        ? explainReasons(reasons)
        : "La opinión cumple los límites de esta cuenta ficticia.",
      candidates,
      cash: input.context?.cash,
      positionQuantity: input.context?.position.quantity,
      estimatedBuyCost: price == null ? null : input.quantity * price * 1.001,
      basis:
        result.analysisMode === "AFTER_CLOSE"
          ? "HISTORICAL_SESSION"
          : "MARKET_SNAPSHOT",
    },
    limitations: [
      ...((result.limitations as string[]) || []),
      "Cuenta ficticia declarada por el usuario. No verifica saldo real, no reserva fondos y no ejecuta operaciones. El costo de compra incluye un margen estimado del 0,1 %, no una comisión confirmada.",
    ],
  };
}
