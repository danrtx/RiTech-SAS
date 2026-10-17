import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { TelemetryGateway } from "../telemetry/telemetry.gateway";
import { DynamicStopLoss, StopLossSample } from "./dynamic-stop-loss";

@Injectable()
export class StopLossService implements OnModuleInit, OnModuleDestroy {
  private readonly engine = new DynamicStopLoss();
  private readonly logger = new Logger(StopLossService.name);
  private queue: StopLossSample[] = [];
  private scheduled?: NodeJS.Immediate;
  private timer?: NodeJS.Timeout;
  private stopped = false;
  constructor(private readonly gateway: TelemetryGateway) {}

  onModuleInit(): void {
    this.timer = setInterval(
      () => this.publish(this.engine.poll(Date.now())),
      100,
    );
    this.timer.unref();
  }

  enqueue(sample: StopLossSample): void {
    if (this.stopped) return;
    if (this.queue.length >= 4096) {
      this.invalidate();
      this.logger.warn("stop_loss_queue_overflow: pending decisions cancelled");
    }
    this.queue.push({
      symbol: sample.symbol,
      price: sample.price,
      eventTimeMs: sample.eventTimeMs,
    });
    if (!this.scheduled) this.scheduled = setImmediate(() => this.drain());
  }

  private drain(): void {
    this.scheduled = undefined;
    const batch = this.queue.splice(0, 128);
    for (const sample of batch) {
      try {
        this.publish(this.engine.accept(sample, Date.now()));
      } catch {
        this.engine.reset(sample.symbol);
        this.logger.error("stop_loss_delivery_failed");
      }
    }
    if (this.queue.length) this.scheduled = setImmediate(() => this.drain());
  }

  private publish(triggers: ReturnType<DynamicStopLoss["poll"]>): void {
    for (const trigger of triggers) {
      try {
        this.gateway.broadcastHedgingAlert({
          ...trigger,
          executionStatus: "REQUESTED",
        });
      } catch {
        this.logger.error("stop_loss_notification_failed");
      }
    }
  }

  invalidate(): void {
    this.queue = [];
    this.engine.reset();
    if (this.scheduled) clearImmediate(this.scheduled);
    this.scheduled = undefined;
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.invalidate();
  }
}
