import { ConfigService } from "@nestjs/config";
import { closingQuality, CLOSING_QUESTIONS_MS } from "./closing-analysis";
import { quality } from "./investment.risk";
import { CreateRecommendation } from "./investment.types";
import { InvestmentService } from "./investment.service";
import { InvestmentStore } from "./investment.store";
import { InvestmentConfig } from "./investment.config";
import { InvestmentMarket } from "./investment.market";
import { GeminiClient } from "./gemini.client";
import { fixture, analysis } from "./testing/fixtures";

const close = Date.parse("2026-11-09T20:59:00Z");
const evening = Date.parse("2026-11-09T23:00:00Z"); // 18:00 Colombia
const config = new InvestmentConfig(new ConfigService());
function input() {
  return {
    ...fixture(evening),
    context: null,
    contextVersion: null,
    market: {
      ...fixture(evening).market,
      live: false,
      quoteSource: "closed_1min_bars" as const,
      sessionDateNY: "2026-11-09",
      quotedAt: close,
      referenceAt: close - 60000,
      atrAt: close,
      atrSource: "provider_ohlc" as const,
      session: "OUTSIDE_REGULAR_WINDOW" as const,
    },
  };
}
describe("After-close review is separate from live trading", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(evening);
  });
  afterEach(() => jest.useRealTimers());
  it.each([evening, evening + 2 * 3600000])(
    "accepts the actual close at 18-20 Colombia: %s",
    (now) => {
      expect(closingQuality(input(), now)).toEqual([]);
      expect(quality(input(), config, now)).toContain("COTIZACION_NO_VIGENTE");
    },
  );
  it.each([
    { live: true },
    { simulated: true },
    { quoteSource: undefined },
    { quotedAt: close - 60000 },
    { referenceAt: close - 120000 },
    { sessionDateNY: "2026-11-08" },
    { atrAt: close - 60000 },
    { atrStatus: "insufficientData" },
    { price: null },
  ])("rejects incomplete or mislabelled evidence %j", (override) => {
    const value = input();
    expect(
      closingQuality(
        { ...value, market: { ...value.market, ...override } },
        evening,
      ).length,
    ).toBeGreaterThan(0);
  });
  it("rejects future or over-age close and allows a dated Friday on the weekend", () => {
    expect(closingQuality(input(), close).length).toBeGreaterThan(0);
    expect(
      closingQuality(input(), close + 7 * 86400000).length,
    ).toBeGreaterThan(0);
    const value = input();
    const friday = Date.parse("2026-11-06T20:59:00Z");
    expect(
      closingQuality(
        {
          ...value,
          market: {
            ...value.market,
            quotedAt: friday,
            atrAt: friday,
            referenceAt: friday - 60000,
            sessionDateNY: "2026-11-06",
          },
        },
        evening,
      ),
    ).toEqual([]);
  });
  it("handles US daylight saving using New York time, not a fixed UTC close", () => {
    const summer = Date.parse("2026-07-06T19:59:00Z");
    const value = input();
    expect(
      closingQuality(
        {
          ...value,
          market: {
            ...value.market,
            quotedAt: summer,
            atrAt: summer,
            referenceAt: summer - 60000,
            sessionDateNY: "2026-07-06",
          },
        },
        Date.parse("2026-07-06T23:00:00Z"),
      ),
    ).toEqual([]);
  });
  it("requires an explicit supported mode", () => {
    expect(
      CreateRecommendation.parse({ symbol: "QQQ", quantity: 1 }).mode,
    ).toBeUndefined();
    expect(() =>
      CreateRecommendation.parse({
        symbol: "QQQ",
        quantity: 1,
        mode: "BYPASS",
      }),
    ).toThrow();
  });
  function setup() {
    const store = {
      claim: jest.fn(async () => ({ id: "closing-id", cached: false })),
      consume: jest.fn(),
      finish: jest.fn(async (_scope, _id, result) => result),
      owned: jest.fn(),
      audit: jest.fn(),
    };
    const market = {
      snapshot: jest.fn(() => input().market),
      closingSnapshot: jest.fn(async () => input().market),
    };
    const model = {
      generate: jest.fn(async () => ({
        data: analysis as unknown,
        modelVersion: "test-model",
      })),
    };
    const service = new InvestmentService(
      store as unknown as InvestmentStore,
      config,
      market as unknown as InvestmentMarket,
      model as unknown as GeminiClient,
    );
    return { store, market, model, service };
  }
  it("persists a dated retrospective opinion with four-hour questions and no order authorization", async () => {
    const { service, model } = setup();
    const result = await service.create("general", "key", {
      symbol: "QQQ",
      quantity: 5,
      mode: "AFTER_CLOSE",
    });
    expect(result).toMatchObject({
      status: "ANALISIS_AL_CIERRE",
      analysisMode: "AFTER_CLOSE",
      decision: "ABSTENERSE",
      modelDecision: "COMPRAR",
      operable: false,
      orderStatus: "NO_ORDER_REQUESTED",
      sessionDateNY: "2026-11-09",
      validUntil: evening + CLOSING_QUESTIONS_MS,
      questionsUntil: evening + CLOSING_QUESTIONS_MS,
    });
    expect(model.generate).toHaveBeenCalledTimes(1);
    expect(result.indicators.quotedAt).toBe(close);
  });
  it("does not pay for Gemini when historical close fails validation", async () => {
    const { service, model, market } = setup();
    market.closingSnapshot.mockResolvedValue({
      ...input().market,
      atrStatus: "insufficientData",
    });
    expect(
      (
        await service.create("general", "key", {
          symbol: "QQQ",
          quantity: 1,
          mode: "AFTER_CLOSE",
        })
      ).status,
    ).toBe("DATOS_INSUFICIENTES");
    expect(model.generate).not.toHaveBeenCalled();
  });
  it("allows a follow-up at 20:00 and blocks it after the discussion period", async () => {
    const { service, model, store } = setup();
    store.owned.mockResolvedValue({
      result: {
        status: "ANALISIS_AL_CIERRE",
        decision: "ABSTENERSE",
        validUntil: evening + CLOSING_QUESTIONS_MS,
      },
      input: input(),
    });
    model.generate.mockResolvedValue({
      data: {
        answer: "Revisión histórica de la sesión.",
        requiresNewEvaluation: false,
      },
      modelVersion: "test-model",
    });
    jest.setSystemTime(evening + 2 * 3600000);
    expect(
      (await service.question("general", "id", "q1", "¿Qué significa el ATR?"))
        .status,
    ).toBe("READY");
    jest.setSystemTime(evening + CLOSING_QUESTIONS_MS);
    expect(
      (await service.question("general", "id", "q2", "¿Qué significa el ATR?"))
        .status,
    ).toBe("REQUIERE_NUEVA_EVALUACION");
    expect(model.generate).toHaveBeenCalledTimes(1);
  });
});
