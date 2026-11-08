import { Module } from "@nestjs/common";
import { TelemetryModule } from "../telemetry/telemetry.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { InvestmentAnalysisService } from "./investment-analysis.service";
import { StopLossService } from "./stop-loss.service";
import { PaperExecutionService } from "./paper-execution.service";
import { PipelineLatencyService } from "./pipeline-latency";
import { PipelineLatencyController } from "./pipeline-latency.controller";

@Module({
  imports: [TelemetryModule, NotificationsModule],
  providers: [
    InvestmentAnalysisService,
    StopLossService,
    PaperExecutionService,
    PipelineLatencyService,
  ],
  controllers: [PipelineLatencyController],
  exports: [InvestmentAnalysisService, StopLossService, PipelineLatencyService],
})
export class HedgingModule {}
