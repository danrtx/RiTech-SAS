import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import { createServer, Server } from "node:http";
import { AddressInfo } from "node:net";
import { io, Socket } from "socket.io-client";
import { TelemetryGateway } from "../modules/telemetry/telemetry.gateway";
import { MarketClock } from "../modules/market-data/market.types";
import { AtrConfig } from "../modules/atr/atr.config";
import { StopLossService } from "../modules/hedging/stop-loss.service";
import { StopLossTrigger } from "../modules/hedging/dynamic-stop-loss";
import { MarketAtrConsumer } from "../modules/market-data/market-atr.consumer";
import { parseMarketDataConfig } from "../modules/market-data/market-data.config";
import { RedisCacheService } from "../modules/redis-cache/redis-cache.service";
import { AtrService } from "../modules/atr/atr.service";
import { IngestionState } from "../modules/market-data/ingestion.state";
import { PriceAnalysisService } from "../modules/market-data/analysis/price-analysis.service";
import { InvestmentAnalysisService } from "../modules/hedging/investment-analysis.service";
import { normalizedTick } from "../modules/market-data/testing/market-tick.fixture";
import { MockOrderFlow, MockOrder, MockReceipt } from "./mock-order-flow";

/** HTTP broker + real Nest Socket.IO; the mobile endpoint is a simulated client. */
describe("Sprint 3: market -> trigger -> mock IOC -> mobile socket", () => {
  let app: INestApplication;
  let broker: Server;
  let mobile: Socket;
  let consumer: MarketAtrConsumer;
  let flow: MockOrderFlow;
  let scenario: string;
  let requests: MockOrder[];
  let accepted: Map<string, MockReceipt>;
  let results: Promise<Record<string, unknown>>[];
  let messages: Record<string, unknown>[];
  let gateway: TelemetryGateway;
  let stop: StopLossService;

  beforeEach(async () => {
    scenario = "accepted";
    requests = [];
    accepted = new Map();
    results = [];
    messages = [];
    broker = createServer(async (req, res) => {
      if (scenario === "offline") return;
      if (req.method === "GET") {
        const id = decodeURIComponent(req.url!.slice("/orders/".length));
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify(
            accepted.get(id) ?? { clientOrderId: id, status: "rejected" },
          ),
        );
        return;
      }
      let body = "";
      for await (const part of req) body += part;
      const order = JSON.parse(body) as MockOrder;
      requests.push(order);
      const rejected =
        scenario === "rejected" ||
        (scenario === "retry" && requests.length === 1);
      const receipt: MockReceipt = accepted.get(order.clientOrderId) ?? {
        clientOrderId: order.clientOrderId,
        status: rejected ? "rejected" : "accepted",
        retryable: scenario === "retry" && rejected,
        ...(rejected ? {} : { acceptedAtMs: Date.now() }),
      };
      if (!rejected) accepted.set(order.clientOrderId, receipt);
      if (scenario === "lost_ack") return;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(receipt));
    });
    await new Promise<void>((resolve) =>
      broker.listen(0, "127.0.0.1", resolve),
    );
    const module = await Test.createTestingModule({
      providers: [
        TelemetryGateway,
        StopLossService,
        { provide: MarketClock, useValue: { now: () => Date.now() } },
        { provide: AtrConfig, useValue: { options: { symbols: ["QQQ"] } } },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.listen(0, "127.0.0.1");
    gateway = app.get(TelemetryGateway);
    stop = app.get(StopLossService);
    flow = new MockOrderFlow(
      `http://127.0.0.1:${(broker.address() as AddressInfo).port}`,
      async (event) => {
        if (!mobile?.connected) return false;
        await gateway.server
          .timeout(1000)
          .emitWithAck("execution_notification", event);
        return true;
      },
      200,
    );
    const broadcast = gateway.broadcastHedgingAlert.bind(gateway);
    jest.spyOn(gateway, "broadcastHedgingAlert").mockImplementation((event) => {
      broadcast(event);
      results.push(flow.run(event as unknown as StopLossTrigger));
    });
    const config = parseMarketDataConfig({
      MARKET_DATA_PROVIDER: "alpaca",
      MARKET_DATA_ENABLED: "true",
      MARKET_DATA_FEED: "mock",
    });
    const analysis = new PriceAnalysisService(
      config,
      gateway,
      new InvestmentAnalysisService(),
    );
    consumer = new MarketAtrConsumer(
      config,
      app.get(AtrConfig),
      {
        appendTick: async () => ({ accepted: true }),
        advanceCoverage: async () => undefined,
      } as unknown as RedisCacheService,
      { invalidateSymbol: () => undefined } as unknown as AtrService,
      analysis,
      new IngestionState(),
      new MarketClock(),
      stop,
    );
    mobile = io(`${await app.getUrl()}/telemetry`, {
      transports: ["websocket"],
      reconnection: false,
    });
    mobile.on("execution_notification", (event, ack) => {
      messages.push(event);
      ack({ received: true });
    });
    await new Promise<void>((resolve, reject) => {
      mobile.once("connect", resolve);
      mobile.once("connect_error", reject);
    });
  });

  afterEach(async () => {
    mobile?.disconnect();
    await app?.close();
    broker?.closeAllConnections();
    await new Promise<void>((resolve) => broker.close(() => resolve()));
  });

  async function drop() {
    const now = Date.now();
    await consumer.consume(normalizedTick(now - 100, 100));
    await consumer.consume(normalizedTick(now, 99));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(results).toHaveLength(1);
    return results[0];
  }

  it("verifies payload, causal order, timestamps and correlation at the mobile client", async () => {
    const result = await drop();
    expect(result).toMatchObject({
      status: "accepted",
      notification: "DELIVERED",
      attempts: 1,
    });
    expect(messages).toHaveLength(1);
    const trigger = result.trigger as StopLossTrigger;
    expect(requests[0]).toMatchObject({
      clientOrderId: trigger.correlationId,
      symbol: "QQQ",
      side: "sell",
      quantity: 1,
      timeInForce: "ioc",
    });
    expect(messages[0].correlationId).toBe(trigger.correlationId);
    expect(trigger.eventTimeMs).toBeLessThanOrEqual(trigger.detectedAtMs);
    expect(trigger.detectedAtMs).toBeLessThanOrEqual(trigger.triggeredAtMs);
    expect(trigger.triggeredAtMs).toBeLessThanOrEqual(
      requests[0].submittedAtMs,
    );
    expect(requests[0].submittedAtMs).toBeLessThanOrEqual(
      (result.receipt as MockReceipt).acceptedAtMs!,
    );
    expect((result.receipt as MockReceipt).acceptedAtMs).toBeLessThanOrEqual(
      result.notifiedAtMs as number,
    );
    await flow.run(trigger);
    expect(requests).toHaveLength(1);
    expect(messages).toHaveLength(1);
  });
  it.each(["rejected", "retry", "lost_ack", "offline"])(
    "covers %s without duplicate orders",
    async (mode) => {
      scenario = mode;
      const result = await drop();
      expect(result.status).toBe(
        mode === "rejected"
          ? "rejected"
          : mode === "offline"
            ? "unknown"
            : "accepted",
      );
      expect(result.attempts).toBe(mode === "retry" ? 2 : 1);
      expect(accepted.size).toBe(
        mode === "retry" || mode === "lost_ack" ? 1 : 0,
      );
      expect(messages).toHaveLength(1);
    },
  );
  it("records absence of device while preserving the accepted order", async () => {
    mobile.disconnect();
    const result = await drop();
    expect(result).toMatchObject({
      status: "accepted",
      notification: "NO_DEVICE",
    });
    expect(messages).toHaveLength(0);
  });
  it("does not create orders for recovery ticks", async () => {
    const signal = new AbortController().signal;
    const now = Date.now();
    await consumer.consume(normalizedTick(now - 1000, 100), {
      signal,
      recovery: true,
    });
    await consumer.consume(normalizedTick(now, 99), { signal, recovery: true });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(results).toHaveLength(0);
  });
});
