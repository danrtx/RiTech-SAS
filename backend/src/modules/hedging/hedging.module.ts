import { Module } from '@nestjs/common';
import { TelemetryModule } from '../telemetry/telemetry.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { InvestmentAnalysisService } from './investment-analysis.service';
import { StopLossService } from './stop-loss.service';
import { PipelineLatencyService } from './pipeline-latency';
import { PipelineLatencyController } from './pipeline-latency.controller';

@Module({
  // NotificationsModule aporta PushNotificationService para las alertas FCM del stop-loss.
  imports: [TelemetryModule, NotificationsModule],
  // PipelineLatencyService se exporta para que otros módulos (y pruebas) lean la latencia.
  providers: [InvestmentAnalysisService, StopLossService, PipelineLatencyService],
  controllers: [PipelineLatencyController],
  exports: [InvestmentAnalysisService, StopLossService, PipelineLatencyService],
})
export class HedgingModule {}
