import { Injectable, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { TelemetryService } from "../telemetry/telemetry.service";
import { MarketClock } from "./market.types";
import { IngestionState } from "./ingestion.state";
import { ReplayFeedClient } from "./replay-feed.client";

@Injectable()
export class MockFeedService implements OnModuleInit, OnModuleDestroy {
  private client?: ReplayFeedClient;
  constructor(
    private readonly config: ConfigService,
    private readonly clock: MarketClock,
    private readonly state: IngestionState,
    private readonly telemetry: TelemetryService,
  ) {}
  onModuleInit() {
    const url = this.config.get<string>("MOCK_FEED_URL");
    if (!url) return;
    const parsed = new URL(url);
    if (
      this.config.get<string>("NODE_ENV") === "production" ||
      parsed.protocol !== "ws:" ||
      !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
    ) {
      throw new Error(
        "MOCK_FEED_URL is only allowed on loopback outside production",
      );
    }
    this.client = new ReplayFeedClient(
      { url, reconnectMs: 100, maxPending: 10000, handshakeTimeoutMs: 5000 },
      this.clock,
      this.state,
      (tick) => this.telemetry.processIncomingTick(tick),
    );
    this.client.start();
  }
  async onModuleDestroy() {
    await this.client?.stop();
  }
}
