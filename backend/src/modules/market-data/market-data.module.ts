import { Module } from "@nestjs/common";
import { TelemetryModule } from "../telemetry/telemetry.module";
import { MockFeedService } from "./mock-feed.service";

@Module({
  imports: [TelemetryModule],
  providers: [MockFeedService],
  exports: [],
})
export class MarketDataModule {}
