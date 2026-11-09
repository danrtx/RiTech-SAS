import { ConfigService } from "@nestjs/config";
import { InvestmentConfig } from "./investment.config";
import { InvestmentService } from "./investment.service";
import { InvestmentStore } from "./investment.store";
import { InvestmentMarket } from "./investment.market";
import { GeminiClient } from "./gemini.client";
import {
  CreateRecommendation,
  SimulationAccount,
  SimulationAccountInput,
} from "./investment.types";
import { analysis, fixture } from "./testing/fixtures";

const now = Date.parse("2026-11-09T16:00:10Z");
const account = (): SimulationAccountInput => ({
  kind: "SIMULATED",
  cash: 10000,
  position: { quantity: 5, averageEntry: 90 },
  otherExposure: 100,
  maxExposure: 20000,
  maxInstrumentExposure: 15000,
  maxTradeRisk: 1000,
  stopLoss: 95,
  maxAtrPercent: 2,
});

describe("User-declared simulated account, never orders", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(now);
  });
  afterEach(() => jest.useRealTimers());
  function setup(decision = "COMPRAR", mode = "LIVE") {
    const snapshot = fixture(now).market;
    const bars = {
      ...snapshot,
      live: false,
      quoteSource: "closed_1min_bars" as const,
      quotedAt: now - 70000,
      referenceAt: now - 130000,
      atrAt: now - 70000,
    };
    const close = Date.parse("2026-11-06T20:59:00Z");
    const store = {
      claim: jest.fn(async () => ({ id: "scenario", cached: false })),
      context: jest.fn(async () => ({ context: null, contextVersion: null })),
      consume: jest.fn(),
      finish: jest.fn(async (_scope, _id, result) => result),
    };
    const market = {
      snapshot: jest.fn(() =>
        mode === "BARS" ? { ...snapshot, live: false } : snapshot,
      ),
      closedBarSnapshot: jest.fn(() => bars),
      closingSnapshot: jest.fn(async () => ({
        ...bars,
        quotedAt: close,
        referenceAt: close - 60000,
        atrAt: close,
        atrSource: "provider_ohlc",
        sessionDateNY: "2026-11-06",
      })),
    };
    const gemini = {
      generate: jest.fn(async () => ({
        data: { ...analysis, decision },
        modelVersion: "test",
      })),
    };
    const service = new InvestmentService(
      store as unknown as InvestmentStore,
      new InvestmentConfig(new ConfigService()),
      market as unknown as InvestmentMarket,
      gemini as unknown as GeminiClient,
    );
    return { service, store, market, gemini };
  }

  it.each(["COMPRAR", "VENDER", "MANTENER", "ABSTENERSE"])(
    "validates %s only for the fictional scenario",
    async (decision) => {
      const { service, store, gemini } = setup(decision);
      const result = await service.create("general", "key", {
        symbol: "QQQ",
        quantity: 2,
        simulation: account(),
      });
      expect(result).toMatchObject({
        simulationDecision: decision,
        accountMode: "SIMULATED",
        decision: "ABSTENERSE",
        operable: false,
        orderStatus: "NO_ORDER_REQUESTED",
        simulationValidation: { passed: true },
      });
      expect(store.context).not.toHaveBeenCalled();
      expect(gemini.generate).toHaveBeenCalledWith(
        "analysis",
        expect.objectContaining({
          context: expect.objectContaining({
            source: "USER_DECLARED_SIMULATION",
            cash: 10000,
          }),
        }),
        undefined,
      );
    },
  );
  it.each([
    ["COMPRAR", { cash: 0 }, "CAPITAL_INSUFICIENTE"],
    [
      "VENDER",
      { position: { quantity: 0, averageEntry: 0 } },
      "POSICION_INSUFICIENTE",
    ],
    ["COMPRAR", { maxTradeRisk: 1 }, "RIESGO_POR_OPERACION"],
    ["COMPRAR", { maxInstrumentExposure: 600 }, "LIMITE_INSTRUMENTO"],
    [
      "COMPRAR",
      { maxExposure: 650, maxInstrumentExposure: 650 },
      "EXPOSICION_MAXIMA",
    ],
  ] as const)(
    "blocks %s when %s violates limits",
    async (decision, changes, reason) => {
      const { service } = setup(decision);
      const result = await service.create("general", "key", {
        symbol: "QQQ",
        quantity: 2,
        simulation: { ...account(), ...changes },
      });
      expect(result).toMatchObject({
        simulationDecision: "ABSTENERSE",
        simulationValidation: {
          passed: false,
          reasons: expect.arrayContaining([reason]),
        },
      });
    },
  );
  it("assesses SELL independently of an unaffordable model BUY", async () => {
    const { service } = setup();
    const result = await service.create("general", "key", {
      symbol: "QQQ",
      quantity: 2,
      simulation: { ...account(), cash: 0 },
    });
    expect(result.simulationValidation).toMatchObject({
      candidates: expect.arrayContaining([
        expect.objectContaining({ decision: "VENDER", allowed: true }),
        expect.objectContaining({ decision: "COMPRAR", allowed: false }),
      ]),
    });
  });
  it.each(["BARS", "CLOSE"])(
    "can validate fictional balances against %s without authorizing live trading",
    async (mode) => {
      const { service } = setup("COMPRAR", mode);
      const result = await service.create("general", "key", {
        symbol: "QQQ",
        quantity: 2,
        mode: mode === "CLOSE" ? "AFTER_CLOSE" : "INTRADAY",
        simulation: account(),
      });
      expect(result).toMatchObject({
        simulationDecision: "COMPRAR",
        decision: "ABSTENERSE",
        operable: false,
      });
      if (mode === "CLOSE")
        expect(result.simulationValidation).toMatchObject({
          basis: "HISTORICAL_SESSION",
        });
    },
  );
  it("rejects data that expires while Gemini responds", async () => {
    const { service, gemini } = setup();
    gemini.generate.mockImplementationOnce(async () => {
      jest.setSystemTime(now + 120000);
      return { data: analysis, modelVersion: "test" };
    });
    const result = await service.create("general", "key", {
      symbol: "QQQ",
      quantity: 2,
      simulation: account(),
    });
    expect(result).toMatchObject({
      simulationDecision: "ABSTENERSE",
      simulationValidation: { passed: false },
    });
  });
  it("does not allow caller claims of real verification or execution", () => {
    for (const extra of [
      { kind: "REAL" },
      { source: "broker" },
      { tradingEnabled: true },
      { cash: -1 },
    ])
      expect(
        SimulationAccount.safeParse({ ...account(), ...extra }).success,
      ).toBe(false);
    expect(
      CreateRecommendation.safeParse({
        symbol: "QQQ",
        quantity: 1,
        executeOrder: true,
        simulation: account(),
      }).success,
    ).toBe(false);
    expect(
      SimulationAccount.safeParse({
        ...account(),
        maxInstrumentExposure: 30000,
      }).success,
    ).toBe(false);
  });
  it("keeps the original mode without a simulated account", async () => {
    const { service } = setup();
    const result = await service.create("general", "key", {
      symbol: "QQQ",
      quantity: 2,
    });
    expect(result.simulationDecision).toBeUndefined();
    expect(result.decision).toBe("ABSTENERSE");
  });
});
