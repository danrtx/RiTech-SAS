import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TelemetryModule } from '../telemetry/telemetry.module';
import { MARKET_DATA_CONFIG, MarketDataConfig } from './market-data.config';
import { MarketDataWsClient } from './market-data-ws.client';
import { MarketDataService } from './market-data.service';

@Module({
  imports: [ConfigModule, TelemetryModule],
  providers: [
    MarketDataWsClient,
    MarketDataService,
    {
      provide: MARKET_DATA_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService): MarketDataConfig =>
        config.getOrThrow<MarketDataConfig>('marketData'),
    },
  ],
  exports: [MARKET_DATA_CONFIG, MarketDataWsClient],
})
export class MarketDataModule {}
