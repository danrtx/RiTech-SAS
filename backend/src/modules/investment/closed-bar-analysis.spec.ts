import { ConfigService } from "@nestjs/config";
import { InvestmentConfig } from "./investment.config";
import { InvestmentService } from "./investment.service";
import { InvestmentStore } from "./investment.store";
import { InvestmentMarket } from "./investment.market";
import { GeminiClient } from "./gemini.client";
import { closedBarQuality, quality } from "./investment.risk";
import { analysis, fixture } from "./testing/fixtures";

const now = Date.parse("2026-11-09T16:00:10Z");
const config = new InvestmentConfig(new ConfigService());
const barMarket = () => ({
  ...fixture(now).market,
  live: false,
  quoteSource: "closed_1min_bars" as const,
  quotedAt: now - 70000,
  referenceAt: now - 130000,
  atrAt: now - 70000,
});

describe("Informational analysis from real closed bars", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(now);
  });
  afterEach(() => jest.useRealTimers());
  it("accepts closed bars only for analysis, keeping live quality blocked", () => {
    const input = { ...fixture(now), market: barMarket() };
    expect(closedBarQuality(input, config, now)).toEqual([]);
    expect(quality(input, config, now)).toContain("COTIZACION_NO_VIGENTE");
  });
  it.each([
    { quotedAt: now - 10000 }, // forming bar
    { quotedAt: now + 50000 }, // future bar
    { quotedAt: now - 190000, referenceAt: now - 250000 },
    { referenceAt: now - 190000 }, // missing minute
    { live: true },
    { quoteSource: undefined },
    { simulated: true },
    { provider: "alpaca" },
    { atrAt: now - 300000 },
  ])("rejects invalid analytical evidence %j", (override) => {
    expect(
      closedBarQuality(
        { ...fixture(now), market: { ...barMarket(), ...override } },
        config,
        now,
      ).length,
    ).toBeGreaterThan(0);
  });
  function setup() {
    const store = {
      claim: jest.fn(async () => ({ id: "test-request", cached: false })),
      context: jest.fn(async () => ({ context: null, contextVersion: null })),
      consume: jest.fn(),
      finish: jest.fn(async (_scope, _id, result) => result),
    };
    const market = {
      snapshot: jest.fn(() => ({
        ...fixture(now).market,
        live: false,
        price: null,
        referencePrice: null,
      })),
      closedBarSnapshot: jest.fn(() => barMarket()),
    };
    const model = {
      generate: jest.fn(async () => ({
        data: analysis,
        modelVersion: "test-model",
      })),
    };
    const service = new InvestmentService(
      store as unknown as InvestmentStore,
      config,
      market as unknown as InvestmentMarket,
      model as unknown as GeminiClient,
    );
    return { service, model, store, market };
  }
  it("generates and persists an opinion without authorizing an operation, even with no live history", async () => {
    const { service, model, store } = setup();
    const result = await service.create("general", "test", {
      symbol: "QQQ",
      quantity: 1,
    });
    expect(result).toMatchObject({
      status: "ANALISIS_INFORMATIVO",
      decision: "ABSTENERSE",
      modelDecision: "COMPRAR",
      operable: false,
      orderStatus: "NO_ORDER_REQUESTED",
      modelVersion: "test-model",
    });
    expect(result.riskValidation.passed).toBe(false);
    expect(model.generate).toHaveBeenCalledTimes(1);
    expect(store.finish.mock.calls[0][2].indicators.quotedAt).toBe(now - 70000);
  });
  it("never calls Gemini for stale bars", async () => {
    const { service, model } = setup();
    jest.setSystemTime(now + 180000);
    expect(
      (await service.create("general", "test", { symbol: "QQQ", quantity: 1 }))
        .status,
    ).toBe("DATOS_INSUFICIENTES");
    expect(model.generate).not.toHaveBeenCalled();
  });
  it("discards an opinion if the bars expire while Gemini responds", async () => {
    const { service, model } = setup();
    model.generate.mockImplementation(async () => {
      jest.setSystemTime(now + 180000);
      return { data: analysis, modelVersion: "test-model" };
    });
    expect(
      await service.create("general", "test", { symbol: "QQQ", quantity: 1 }),
    ).toMatchObject({
      status: "DATOS_INSUFICIENTES",
      modelDecision: null,
      decision: "ABSTENERSE",
      operable: false,
    });
  });
});
