import { Injectable } from "@nestjs/common";
import { InvestmentStore } from "./investment.store";
import { InvestmentConfig } from "./investment.config";
import { InvestmentMarket } from "./investment.market";
import { GeminiClient, GeminiFailure } from "./gemini.client";
import {
  closingQuality,
  CLOSING_HISTORY_MAX_AGE_MS,
  CLOSING_QUESTIONS_MS,
} from "./closing-analysis";
import {
  Analysis,
  EvaluationInput,
  ModelAnalysis,
  ModelAnswer,
  PROMPT_VERSION,
  instrument,
} from "./investment.types";
import {
  CLOSED_BAR_MAX_AGE_MS,
  closedBarQuality,
  explainReasons,
  quality,
  risk,
} from "./investment.risk";

@Injectable()
export class InvestmentService {
  constructor(
    private readonly store: InvestmentStore,
    private readonly config: InvestmentConfig,
    private readonly market: InvestmentMarket,
    private readonly gemini: GeminiClient,
  ) {}
  private async quota(scope: string) {
    await this.store.consume([
      { key: "gemini:global", limit: this.config.globalCalls, seconds: 3600 },
      {
        key: `gemini:${scope}`,
        limit: this.config.generalCalls,
        seconds: 3600,
      },
    ]);
  }
  async create(
    scope: string,
    key: string,
    request: {
      symbol: "QQQ";
      quantity: number;
      mode?: "INTRADAY" | "AFTER_CLOSE";
    },
    signal?: AbortSignal,
  ) {
    const claim = await this.store.claim(scope, key, "recommendation", request);
    if (claim.cached) return claim.result;
    const now = Date.now();
    let input: EvaluationInput = {
      context: null,
      contextVersion: null,
      market: this.market.snapshot(),
      quantity: request.quantity,
    };
    let result: Record<string, unknown> = {
      id: claim.id,
      correlationId: claim.id,
      instrument,
      quantity: request.quantity,
      referenceIndex: "NDX",
      scope: "GENERAL",
      operable: false,
      status: "READY",
      decision: "ABSTENERSE",
      generatedAt: now,
      validUntil: now,
      promptVersion: PROMPT_VERSION,
      model: this.config.model,
      modelVersion: null,
      uncertainty: "ALTA",
      limitations: [
        "Apoyo a la decisión, sin garantía de rendimiento.",
        "La ventana regular no sustituye un calendario bursátil; se exige cotización viva.",
        instrument.limitations,
      ],
      orderStatus: "NO_ORDER_REQUESTED",
      humanConfirmationRequired: true,
    };
    try {
      if (request.mode === "AFTER_CLOSE") {
        result = {
          ...result,
          analysisMode: "AFTER_CLOSE",
          horizon: "REVISION_SESION_FINALIZADA",
          status: "DATOS_INSUFICIENTES",
          indicators: null,
          limitations: [
            instrument.limitations,
            "Revisión histórica de una sesión finalizada, no cotización actual ni recomendación operativa.",
            "La variación compara las dos últimas velas de un minuto, no el rendimiento de toda la sesión.",
            "Solo se admite cierre regular completo de 16:00 de Nueva York; cierres anticipados requieren calendario bursátil.",
          ],
        };
        const closing = await this.market.closingSnapshot();
        if (!closing) {
          result.justification =
            "No hay un cierre regular completo disponible. Intenta después del cierre o revisa la fuente histórica.";
          return this.store.finish(scope, claim.id, result, input);
        }
        input = { ...input, market: closing };
        const reasons = closingQuality(input, Date.now());
        result = {
          ...result,
          indicators: closing,
          sessionDateNY: closing.sessionDateNY,
          sources: [
            {
              provider: closing.provider,
              quotedAt: closing.quotedAt,
              atrAt: closing.atrAt,
              quoteSource: closing.quoteSource,
            },
          ],
          riskValidation: {
            passed: false,
            reasons: ["SOLO_REVISION_AL_CIERRE", ...reasons],
          },
        };
        if (reasons.length) {
          result.justification =
            "No se pudo validar el cierre: faltan velas consecutivas, ATR consistente o el histórico supera siete días.";
          return this.store.finish(scope, claim.id, result, input);
        }
        await this.quota(scope);
        const response = await this.gemini.generate(
          "analysis",
          {
            instrument,
            ...input,
            analysisMode: "AFTER_CLOSE",
            sessionDateNY: closing.sessionDateNY,
          },
          signal,
        );
        const analysis = ModelAnalysis.parse(response.data);
        const invalid = closingQuality(input, Date.now()).length > 0;
        const until = Math.min(
          Date.now() + CLOSING_QUESTIONS_MS,
          (closing.quotedAt || 0) + CLOSING_HISTORY_MAX_AGE_MS,
        );
        result = {
          ...result,
          ...analysis,
          status: invalid ? "DATOS_INSUFICIENTES" : "ANALISIS_AL_CIERRE",
          decision: "ABSTENERSE",
          modelDecision: invalid ? null : analysis.decision,
          operable: false,
          modelVersion: response.modelVersion,
          generatedAt: Date.now(),
          validUntil: invalid ? Date.now() : until,
          questionsUntil: invalid ? Date.now() : until,
          justification: invalid
            ? "El histórico dejó de cumplir el límite temporal durante la generación."
            : analysis.justification,
          limitations: [
            ...(result.limitations as string[]),
            ...analysis.limitations,
          ],
        };
        return this.store.finish(scope, claim.id, result, input);
      }
      input = { ...input, ...(await this.store.context()) };
      const reasons = quality(input, this.config, Date.now()).filter(
        (reason) => reason !== "CONTEXTO_FINANCIERO_AUSENTE",
      );
      result = {
        ...result,
        horizon: input.context?.horizon ?? "ANALISIS_GENERAL_INTRADIA",
        indicators: input.market,
        sources: [
          {
            provider: input.market.provider,
            quotedAt: input.market.quotedAt,
            atrAt: input.market.atrAt,
            atrSource: input.market.atrSource,
          },
          {
            provider: input.context?.source ?? null,
            asOf: input.context?.asOf ?? null,
          },
        ],
        riskValidation: { passed: false, reasons },
      };
      if (
        reasons.length &&
        reasons.every((reason) =>
          [
            "COTIZACION_NO_VIGENTE",
            "HISTORIAL_INSUFICIENTE",
            "PRECIO_INVALIDO",
          ].includes(reason),
        )
      ) {
        const bars = this.market.closedBarSnapshot?.();
        if (
          bars &&
          !closedBarQuality({ ...input, market: bars }, this.config, Date.now())
            .length
        ) {
          input = { ...input, market: bars };
          await this.quota(scope);
          const response = await this.gemini.generate(
            "analysis",
            {
              instrument,
              ...input,
              analysisMode: "CLOSED_BARS_INFORMATIONAL_ONLY",
              instruction:
                "Analiza las velas cerradas reales de un minuto. No son cotizaciones instantáneas. Explica escenarios y limitaciones; no hay autorización operativa.",
            },
            signal,
          );
          const analysis = ModelAnalysis.parse(response.data);
          const currentBars = this.market.closedBarSnapshot();
          const expired =
            closedBarQuality(input, this.config, Date.now()).length > 0 ||
            !currentBars ||
            closedBarQuality(
              { ...input, market: currentBars },
              this.config,
              Date.now(),
            ).length > 0;
          const expiry = Math.min(
            Date.now() + this.config.validity,
            (bars.quotedAt || 0) + CLOSED_BAR_MAX_AGE_MS,
            (bars.atrAt || 0) + this.config.atrAge,
          );
          result = {
            ...result,
            ...analysis,
            status: expired ? "DATOS_INSUFICIENTES" : "ANALISIS_INFORMATIVO",
            analysisMode: "CLOSED_BARS_INFORMATIONAL_ONLY",
            modelDecision: expired ? null : analysis.decision,
            decision: "ABSTENERSE",
            operable: false,
            modelVersion: response.modelVersion,
            indicators: bars,
            sources: [
              {
                provider: bars.provider,
                quotedAt: bars.quotedAt,
                quoteSource: bars.quoteSource,
                atrAt: bars.atrAt,
                atrSource: bars.atrSource,
              },
            ],
            generatedAt: Date.now(),
            validUntil: expired ? Date.now() : expiry,
            justification: expired
              ? "Las velas vencieron durante el análisis. Solicita una nueva evaluación."
              : analysis.justification,
            riskValidation: {
              passed: false,
              reasons: ["SOLO_ANALISIS_VELAS_CERRADAS", ...reasons],
            },
            limitations: [
              ...(result.limitations as string[]),
              ...analysis.limitations,
              "Análisis informativo de velas cerradas de un minuto; no habilita decisiones operativas ni sustituye el control de cotización de 2 segundos.",
            ],
          };
          return this.store.finish(scope, claim.id, result, input);
        }
      }
      if (reasons.length)
        result = {
          ...result,
          status: "DATOS_INSUFICIENTES",
          justification: explainReasons(reasons),
        };
      else {
        // Skip paid generation when no actionable decision can pass the independent policy.
        const preliminary = ["COMPRAR", "VENDER", "MANTENER"].map((d) =>
          risk(input, d),
        );
        if (input.context && preliminary.every((r) => r.length)) {
          const reasons = [...new Set(preliminary.flat())];
          result = {
            ...result,
            justification: "Las restricciones actuales requieren abstenerse.",
            riskValidation: { passed: false, reasons },
          };
        } else {
          await this.quota(scope);
          const response = await this.gemini.generate(
            "analysis",
            {
              instrument,
              ...input,
              allowedDecisions: ["COMPRAR", "VENDER", "MANTENER", "ABSTENERSE"],
            },
            signal,
          );
          const analysis: Analysis = ModelAnalysis.parse(response.data);
          const current = {
            ...input,
            ...(await this.store.context()),
            market: this.market.snapshot(),
          };
          const reasons = [
            ...quality(current, this.config, Date.now()),
            ...risk(input, analysis.decision),
            ...risk(current, analysis.decision),
          ];
          if (current.contextVersion !== input.contextVersion)
            reasons.push("CONTEXTO_MODIFICADO");
          if (
            input.market.price &&
            current.market.price &&
            Math.abs(current.market.price / input.market.price - 1) > 0.001
          )
            reasons.push("PRECIO_MODIFICADO");
          const expiry = Math.min(
            Date.now() + this.config.validity,
            (input.market.quotedAt || 0) + this.config.quoteAge,
            (input.market.atrAt || 0) + this.config.atrAge,
            input.context
              ? input.context.asOf + this.config.contextAge
              : Infinity,
          );
          if (expiry <= Date.now()) reasons.push("EVALUACION_VENCIDA");
          result = {
            ...result,
            ...analysis,
            modelVersion: response.modelVersion,
            generatedAt: Date.now(),
            validUntil: expiry,
            decision: reasons.length ? "ABSTENERSE" : analysis.decision,
            justification: reasons.length
              ? "La propuesta fue descartada por los controles independientes: " +
                explainReasons(reasons)
              : analysis.justification,
            riskValidation: {
              passed: reasons.length === 0,
              reasons: [...new Set(reasons)],
            },
            limitations: [
              ...(result.limitations as string[]),
              ...analysis.limitations,
            ],
          };
        }
      }
    } catch (error) {
      result = {
        ...result,
        status: "NO_DISPONIBLE",
        decision: null,
        justification:
          error instanceof GeminiFailure
            ? error.code
            : "EVALUACION_NO_DISPONIBLE",
        riskValidation: { passed: false, reasons: ["FALLO_TECNICO"] },
      };
    }
    return this.store.finish(scope, claim.id, result, input);
  }
  async get(scope: string, id: string) {
    const row = await this.store.owned(scope, id);
    await this.store.audit(scope, id, "RECOMMENDATION_VIEWED");
    return { ...row.result, expired: row.result.validUntil <= Date.now() };
  }
  async question(
    scope: string,
    id: string,
    key: string,
    question: string,
    signal?: AbortSignal,
  ) {
    const row = await this.store.owned(scope, id);
    const claim = await this.store.claim(scope, key, "question", {
      id,
      question,
    });
    if (claim.cached) return claim.result;
    let result: Record<string, unknown> = {
      id: claim.id,
      correlationId: claim.id,
      recommendationId: id,
      originalDecision: row.result.decision,
      promptVersion: PROMPT_VERSION,
      generatedAt: Date.now(),
      model: this.config.model,
      modelVersion: null,
      orderStatus: "NO_ORDER_REQUESTED",
    };
    try {
      if (
        row.result.validUntil <= Date.now() ||
        !["READY", "ANALISIS_INFORMATIVO", "ANALISIS_AL_CIERRE"].includes(
          row.result.status,
        )
      ) {
        result = {
          ...result,
          status: "REQUIERE_NUEVA_EVALUACION",
          answer:
            "La evaluación no está vigente. Solicita una nueva recomendación para analizar el contexto actual.",
          requiresNewEvaluation: true,
        };
      } else if (
        /ejecut|orden|ignora|instrucci[oó]n|prompt|api.?key|desactiv|system|bypass/i.test(
          question,
        )
      ) {
        result = {
          ...result,
          status: "CONSULTA_RESTRINGIDA",
          answer:
            "Esta consulta solo puede explicar una recomendación; no ejecuta órdenes ni modifica controles.",
          requiresNewEvaluation: false,
        };
      } else {
        await this.quota(scope);
        const response = await this.gemini.generate(
          "question",
          { recommendation: row.result, validatedInput: row.input, question },
          signal,
        );
        result = {
          ...result,
          ...ModelAnswer.parse(response.data),
          status: "READY",
          modelVersion: response.modelVersion,
        };
        if (row.result.validUntil <= Date.now())
          result = { ...result, requiresNewEvaluation: true };
      }
    } catch (error) {
      result = {
        ...result,
        status: "NO_DISPONIBLE",
        answer:
          error instanceof GeminiFailure
            ? error.code
            : "CONSULTA_NO_DISPONIBLE",
        requiresNewEvaluation: false,
      };
    }
    return this.store.finish(scope, claim.id, result);
  }
}
