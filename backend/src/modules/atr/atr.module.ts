import { Module } from "@nestjs/common";
import { AtrService } from "./atr.service";
import { AtrController } from "./atr.controller";
import { TelemetryModule } from "../telemetry/telemetry.module";
import { RedisCacheModule } from "../redis-cache/redis-cache.module";

@Module({
  imports: [RedisCacheModule, TelemetryModule],
  providers: [AtrService],
  controllers: [AtrController],
  exports: [AtrService],
})
export class AtrModule {}
