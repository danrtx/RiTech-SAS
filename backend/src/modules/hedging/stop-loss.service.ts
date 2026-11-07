import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from "@nestjs/common";
import { performance } from "node:perf_hooks";
import { TelemetryGateway } from "../telemetry/telemetry.gateway";
import { PushNotificationService } from "../notifications/push-notification.service";
import { DynamicStopLoss, StopLossSample } from "./dynamic-stop-loss";
import { PipelineLatencyService, PipelineTrace } from "./pipeline-latency";

interface QueuedSample {
  sample: StopLossSample;
  trace?: PipelineTrace;
  enqueuedAtMs: number;
}

@Injectable()
export class StopLossService implements OnModuleInit, OnModuleDestroy {
  private readonly engine = new DynamicStopLoss();
  private readonly logger = new Logger(StopLossService.name);
  private queue: QueuedSample[] = [];
  private scheduled?: NodeJS.Immediate;
  private timer?: NodeJS.Timeout;
  private stopped = false;
  constructor(
    private readonly gateway: TelemetryGateway,
    @Optional() private readonly latency?: PipelineLatencyService,
    @Optional() private readonly push?: PushNotificationService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(
      () => this.publish(this.engine.poll(Date.now())),
      100,
    );
    this.timer.unref();
  }

  enqueue(sample: StopLossSample, trace?: PipelineTrace): void {
    if (this.stopped) return;
    if (this.queue.length >= 4096) {
      this.invalidate();
      this.logger.warn("stop_loss_queue_overflow: pending decisions cancelled");
    }
    this.queue.push({
      sample: {
        symbol: sample.symbol,
        price: sample.price,
        eventTimeMs: sample.eventTimeMs,
      },
      trace,
      enqueuedAtMs: performance.now(),
    });
    if (!this.scheduled) this.scheduled = setImmediate(() => this.drain());
  }

  private drain(): void {
    this.scheduled = undefined;
    const batch = this.queue.splice(0, 128);
    for (const { sample, trace, enqueuedAtMs } of batch) {
      // Momento en que la muestra queda disponible para el motor (fin del tramo NFR-001).
      if (trace) this.latency?.record(trace, enqueuedAtMs, performance.now());
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
      // Solo encola: la entrega FCM nunca bloquea ni hace fallar el trading.
      this.push?.notifyHedgingActivated(trigger);
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
