import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { MarketDataModule } from "../market-data/market-data.module";
import { AtrModule } from "../atr/atr.module";
import { InvestmentConfig } from "./investment.config";
import { InvestmentStore } from "./investment.store";
import { InvestmentMarket } from "./investment.market";
import { GeminiClient } from "./gemini.client";
import { InvestmentService } from "./investment.service";
import { InvestmentController, InvestmentGuard } from "./investment.controller";
@Module({
  imports: [ConfigModule, MarketDataModule, AtrModule],
  providers: [
    InvestmentConfig,
    InvestmentStore,
    InvestmentGuard,
    InvestmentMarket,
    GeminiClient,
    InvestmentService,
  ],
  controllers: [InvestmentController],
})
export class InvestmentModule {}
