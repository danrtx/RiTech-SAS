import { MockFeedService } from './mock-feed.service';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TelemetryModule } from '../telemetry/telemetry.module';
import { MARKET_DATA_CONFIG, MarketDataConfig } from './market-data.config';
import { MarketDataWsClient } from './market-data-ws.client';
import { MarketDataService } from './market-data.service';
import { AlpacaAdapter } from './adapters/alpaca.adapter';
import { MarketDataProcessor } from './market-data.processor';
import { PriceAnalysisService } from './analysis/price-analysis.service';
import { TICK_CONSUMER } from './ports/tick-consumer.interface';
import { MarketDataController } from './market-data.controller';
import { HedgingModule } from '../hedging/hedging.module';

@Module({
  imports: [ConfigModule, TelemetryModule, HedgingModule],
  providers: [
    MockFeedService,
    AlpacaAdapter,
    MarketDataProcessor,
    PriceAnalysisService,
    { provide: TICK_CONSUMER, useExisting: PriceAnalysisService },
    MarketDataWsClient,
    MarketDataService,
    {
      provide: MARKET_DATA_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService): MarketDataConfig =>
        config.getOrThrow<MarketDataConfig>('marketData'),
    },
  ],
  controllers: [MarketDataController],
  exports: [MARKET_DATA_CONFIG, MarketDataWsClient, PriceAnalysisService],
})
export class MarketDataModule {}
