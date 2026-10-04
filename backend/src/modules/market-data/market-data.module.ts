import { Module } from '@nestjs/common';
import { TelemetryModule } from '../telemetry/telemetry.module';

@Module({
  imports: [TelemetryModule],
  providers: [],
  exports: [],
})
export class MarketDataModule {}
