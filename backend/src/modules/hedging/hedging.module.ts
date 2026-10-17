import { Module } from '@nestjs/common';
import { TelemetryModule } from '../telemetry/telemetry.module';
import { InvestmentAnalysisService } from './investment-analysis.service';
import { StopLossService } from './stop-loss.service';

@Module({
  imports: [TelemetryModule],
  providers: [InvestmentAnalysisService, StopLossService],
  exports: [InvestmentAnalysisService, StopLossService],
})
export class HedgingModule {}
