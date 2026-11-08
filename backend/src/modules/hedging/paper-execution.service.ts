import { Injectable } from '@nestjs/common';
import { TelemetryGateway } from '../telemetry/telemetry.gateway';
import { StopLossTrigger } from './dynamic-stop-loss';

/** Explicit paper execution; no network calls and no real financial orders. */
@Injectable()
export class PaperExecutionService {
  private readonly completed = new Set<string>();
  constructor(private readonly gateway: TelemetryGateway) {}

  execute(trigger: StopLossTrigger): void {
    if (process.env.EXECUTION_MODE !== 'paper') return;
    if (this.completed.has(trigger.correlationId)) return;
    // Fail closed when the session deduplication capacity is exhausted.
    if (this.completed.size >= 10000) return;
    this.completed.add(trigger.correlationId);
    this.gateway.broadcastExecutionNotification({
      schemaVersion: 1,
      simulated: true,
      mode: 'paper',
      correlationId: trigger.correlationId,
      symbol: trigger.symbol,
      status: 'SIMULATED_ACCEPTED',
      action: trigger.action,
      referencePrice: trigger.price,
      eventTimeMs: trigger.eventTimeMs,
      triggeredAtMs: trigger.triggeredAtMs,
      notifiedAtMs: Date.now(),
      // No assumed position size or fill: this is an acceptance simulation.
      filledQuantity: 0,
    });
  }
}
