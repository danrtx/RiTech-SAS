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

@Module({
  imports: [ConfigModule, TelemetryModule, HedgingModule],
  providers: [
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
