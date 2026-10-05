import { Logger } from "@nestjs/common";
import { MarketDataWsClient } from "./market-data-ws.client";
import { parseMarketDataConfig } from "./market-data.config";
import { AlpacaMockServer } from "./testing/alpaca-mock.server";
import { waitUntil } from "../../testing/mock-provider";

describe("Market data heartbeat", () => {
  let mock: AlpacaMockServer;
  let client: MarketDataWsClient;
  beforeEach(async () => {
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    mock = new AlpacaMockServer();
    const url = await mock.start();
    client = new MarketDataWsClient(
      parseMarketDataConfig({
        MARKET_DATA_ENABLED: "true",
        MARKET_DATA_FEED: "mock",
        MARKET_DATA_WS_URL: url,
        MARKET_DATA_HEARTBEAT_MS: "40",
        MARKET_DATA_HEARTBEAT_TIMEOUT_MS: "80",
      }),
    );
    await client.start();
  });
  afterEach(async () => {
    await client.onModuleDestroy();
    await mock.stop();
    jest.restoreAllMocks();
  });
  it("keeps an idle market alive using protocol pong, without requiring trades", async () => {
    await new Promise((r) => setTimeout(r, 300));
    expect(client.getStatus().state).toBe("LIVE");
    await client.stop();
    await new Promise((r) => setTimeout(r, 180));
    expect(client.getStatus().state).toBe("STOPPED");
  });
  it("detects a silent route and allows a clean authenticated reconnect", async () => {
    mock.setSilent(true);
    await waitUntil(() => client.getStatus().state === "DEGRADED");
    expect(client.getStatus().lastError?.reason).toBe("heartbeat_timeout");
    mock.setSilent(false);
    await new Promise((r) => setTimeout(r, 20));
    await client.start();
    expect(client.getStatus().state).toBe("LIVE");
  });
});
