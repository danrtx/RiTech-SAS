import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { envConfig } from './config/env.config';
import { DatabaseModule } from './modules/database/database.module';
import { RedisCacheModule } from './modules/redis-cache/redis-cache.module';
import { TelemetryModule } from './modules/telemetry/telemetry.module';
import { MarketDataModule } from './modules/market-data/market-data.module';
import { HedgingModule } from './modules/hedging/hedging.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [envConfig],
    }),
    DatabaseModule,
    RedisCacheModule,
    TelemetryModule,
    MarketDataModule,
    HedgingModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
