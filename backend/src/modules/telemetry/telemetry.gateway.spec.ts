import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { io, Socket } from "socket.io-client";
import { TelemetryGateway } from "./telemetry.gateway";
import { AtrConfig, defaultAtrOptions } from "../atr/atr.config";
import { MarketClock, Tick } from "../market-data/market.types";

describe("Socket.IO telemetry contract over a real local connection", () => {
  let app: INestApplication;
  let client: Socket;
  let gateway: TelemetryGateway;
  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        TelemetryGateway,
        MarketClock,
        { provide: AtrConfig, useValue: { options: defaultAtrOptions } },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useLogger(false);
    await app.listen(0, "127.0.0.1");
    gateway = module.get(TelemetryGateway);
    client = io(`${await app.getUrl()}/telemetry`, {
      transports: ["websocket"],
      forceNew: true,
      reconnection: false,
    });
    await new Promise<void>((resolve, reject) => {
      client.once("connect", resolve);
      client.once("connect_error", reject);
    });
  });
  afterEach(async () => {
    client?.disconnect();
    await app?.close();
  });
  it("subscribes, preserves timestamps, sends ATR and a separate volatility flag", async () => {
    const subscribed = new Promise((resolve) =>
      client.once("subscribed", resolve),
    );
    client.emit("subscribe_symbol", { symbol: "NDX" });
    await subscribed;
    const tick: Tick = {
      id: "source:1",
      symbol: "NDX",
      price: 100,
      volume: 1,
      eventTime: 1000,
      receivedAt: 2000,
    };
    const receivedTick = new Promise<Tick & { timestamp: string }>((resolve) =>
      client.once("telemetry_tick", resolve),
    );
    gateway.broadcastTick("NDX", tick);
    expect(await receivedTick).toMatchObject({
      ...tick,
      timestamp: "1970-01-01T00:00:01.000Z",
    });
    const result = {
      symbol: "NDX",
      minute: 60000,
      emittedAt: 120000,
      atr: 3,
      baseline: 2,
      alert: true,
      status: "ready" as const,
    };
    const receivedAtr = new Promise((resolve) =>
      client.once("atr_result", resolve),
    );
    const receivedAlert = new Promise((resolve) =>
      client.once("volatility_alert", resolve),
    );
    gateway.broadcastAtr(result);
    expect(await receivedAtr).toEqual(result);
    expect(await receivedAlert).toEqual(result);
  });
  it("rejects malformed subscriptions instead of throwing a TypeError", async () => {
    const error = new Promise((resolve) => client.once("exception", resolve));
    client.emit("subscribe_symbol", { symbol: 123 });
    expect(await error).toMatchObject({ status: "error" });
  });
});
