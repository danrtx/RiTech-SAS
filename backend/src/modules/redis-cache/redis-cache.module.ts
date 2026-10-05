import { Module, Global } from "@nestjs/common";
import { RedisCacheService } from "./redis-cache.service";
import { AtrConfig } from "../atr/atr.config";
import { MarketClock } from "../market-data/market.types";
import { IngestionState } from "../market-data/ingestion.state";

@Global()
@Module({
  providers: [RedisCacheService, AtrConfig, MarketClock, IngestionState],
  exports: [RedisCacheService, AtrConfig, MarketClock, IngestionState],
})
export class RedisCacheModule {}
