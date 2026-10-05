import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { envConfig } from './config/env.config';
import { DatabaseModule } from './modules/database/database.module';
import { RedisCacheModule } from './modules/redis-cache/redis-cache.module';
import { TelemetryModule } from './modules/telemetry/telemetry.module';
import { MarketDataModule } from './modules/market-data/market-data.module';
import { HedgingModule } from './modules/hedging/hedging.module';
import { HealthModule } from './modules/health/health.module';
import { AtrModule } from './modules/atr/atr.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Busca .env en backend/ y, si no existe, en la raiz del repo (donde vive el de Docker Compose)
      envFilePath: ['.env', '../.env'],
      load: [envConfig],
    }),
    DatabaseModule,
    RedisCacheModule,
    TelemetryModule,
    MarketDataModule,
    HedgingModule,
    HealthModule,
    AtrModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
