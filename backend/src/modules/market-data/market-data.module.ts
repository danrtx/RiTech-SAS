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
import { TwelveDataAdapter } from './adapters/twelve-data.adapter';
import { MARKET_DATA_ADAPTER } from './ports/market-data-adapter.interface';
import { AtrModule } from '../atr/atr.module';
import { MarketAtrConsumer } from './market-atr.consumer';
import { MarketHistoryClient } from './market-history.client';
import { MarketRecoveryService } from './market-recovery.service';
import { NdxHistoryService } from './ndx-history.service';
import { NdxHistoryController } from './ndx-history.controller';

@Module({
  imports: [ConfigModule, TelemetryModule, HedgingModule, AtrModule],
  providers: [
    MockFeedService,
    NdxHistoryService,
    AlpacaAdapter,
    TwelveDataAdapter,
    {
      provide: MARKET_DATA_ADAPTER,
      inject: [MARKET_DATA_CONFIG, AlpacaAdapter, TwelveDataAdapter],
      useFactory: (
        config: MarketDataConfig,
        alpaca: AlpacaAdapter,
        twelve: TwelveDataAdapter,
      ) => (config.provider === 'twelvedata' ? twelve : alpaca),
    },
    MarketDataProcessor,
    PriceAnalysisService,
    MarketAtrConsumer,
    MarketHistoryClient,
    MarketRecoveryService,
    { provide: TICK_CONSUMER, useExisting: MarketAtrConsumer },
    MarketDataWsClient,
    MarketDataService,
    {
      provide: MARKET_DATA_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService): MarketDataConfig =>
        config.getOrThrow<MarketDataConfig>('marketData'),
    },
  ],
  controllers: [MarketDataController, NdxHistoryController],
  exports: [MARKET_DATA_CONFIG, MarketDataWsClient, PriceAnalysisService],
})
export class MarketDataModule {}
