import { Controller, Get } from '@nestjs/common';
import { PipelineLatencyService } from './pipeline-latency';

@Controller('hedging')
export class PipelineLatencyController {
  constructor(private readonly latency: PipelineLatencyService) {}

  /** NFR-001: p50/p95/máximo por tramo entre ingesta y motor de hedging. */
  @Get('latency')
  latencySnapshot() {
    return this.latency.snapshot();
  }
}
