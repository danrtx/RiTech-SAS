import { Module } from '@nestjs/common';
import { TelemetryModule } from '../telemetry/telemetry.module';
import { InvestmentAnalysisService } from './investment-analysis.service';

@Module({
  imports: [TelemetryModule],
  providers: [InvestmentAnalysisService],
  exports: [InvestmentAnalysisService],
})
export class HedgingModule {}
