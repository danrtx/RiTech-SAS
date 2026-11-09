import { EvaluationInput } from "./investment.types";
import { quality } from "./investment.risk";
import {
  regularSession,
  sessionDate,
  sessionTime,
} from "../market-chart/chart.types";

export const CLOSING_HISTORY_MAX_AGE_MS = 7 * 86400000;
export const CLOSING_QUESTIONS_MS = 4 * 3600000;

/** Retrospective review only. This policy MUST NOT authorize live operations. */
export function closingQuality(input: EvaluationInput, now: number): string[] {
  const m = input.market;
  const reasons = quality(
    input,
    {
      quoteAge: CLOSING_HISTORY_MAX_AGE_MS,
      atrAge: CLOSING_HISTORY_MAX_AGE_MS,
      contextAge: 1,
    },
    now,
  ).filter(
    (reason) =>
      ![
        "COTIZACION_NO_VIGENTE",
        "FUERA_DE_HORARIO_REGULAR",
        "CONTEXTO_FINANCIERO_AUSENTE",
      ].includes(reason),
  );
  const at = m.quotedAt;
  if (
    m.live ||
    m.simulated ||
    m.provider !== "twelvedata" ||
    m.quoteSource !== "closed_1min_bars" ||
    at === null ||
    !Number.isSafeInteger(at) ||
    at % 60000 !== 0 ||
    now - at < 60000 ||
    now - at >= CLOSING_HISTORY_MAX_AGE_MS ||
    !regularSession(at) ||
    sessionTime(at) !== "15:59" ||
    m.sessionDateNY !== sessionDate(at) ||
    (sessionDate(at) === sessionDate(now) && sessionTime(now) < "16:00") ||
    m.referenceAt !== at - 60000 ||
    m.atrAt !== at ||
    m.atrSource !== "provider_ohlc"
  ) {
    reasons.push("CIERRE_NO_VALIDADO");
  }
  return [...new Set(reasons)];
}
