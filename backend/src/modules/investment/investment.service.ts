import { Injectable } from "@nestjs/common";
import { InvestmentStore } from "./investment.store";
import { InvestmentConfig } from "./investment.config";
import { InvestmentMarket } from "./investment.market";
import { GeminiClient, GeminiFailure } from "./gemini.client";
import {
  Analysis,
  EvaluationInput,
  ModelAnalysis,
  ModelAnswer,
  PROMPT_VERSION,
  instrument,
} from "./investment.types";
import { explainReasons, quality, risk } from "./investment.risk";

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
    request: { symbol: "QQQ"; quantity: number },
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
          },
          {
            provider: input.context?.source ?? null,
            asOf: input.context?.asOf ?? null,
          },
        ],
        riskValidation: { passed: false, reasons },
      };
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
        row.result.status !== "READY"
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
