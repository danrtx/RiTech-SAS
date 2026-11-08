import { Test } from "@nestjs/testing";
import { HedgingModule } from "./hedging.module";
import { StopLossService } from "./stop-loss.service";
import { PipelineLatencyService } from "./pipeline-latency";
import { TelemetryGateway } from "../telemetry/telemetry.gateway";
import { TelemetryService } from "../telemetry/telemetry.service";
import { PushNotificationService } from "../notifications/push-notification.service";

describe("Integrated hedging module", () => {
  it("delivers the same trigger to paper execution and push while recording latency", async () => {
    const previousMode = process.env.EXECUTION_MODE;
    process.env.EXECUTION_MODE = "paper";
    const gateway = {
      broadcastHedgingAlert: jest.fn(),
      broadcastExecutionNotification: jest.fn(),
    };
    const push = { notifyHedgingActivated: jest.fn() };
    const module = await Test.createTestingModule({ imports: [HedgingModule] })
      .overrideProvider(TelemetryGateway)
      .useValue(gateway)
      .overrideProvider(TelemetryService)
      .useValue({})
      .overrideProvider(PushNotificationService)
      .useValue(push)
      .compile();
    try {
      const stop = module.get(StopLossService);
      const now = Date.now();
      const monotonic = performance.now();
      const trace = {
        receivedAtMonotonicMs: monotonic,
        consumedAtMonotonicMs: monotonic,
      };
      stop.enqueue(
        { symbol: "QQQ", price: 100, eventTimeMs: now - 1000 },
        trace,
      );
      stop.enqueue({ symbol: "QQQ", price: 99, eventTimeMs: now }, trace);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(gateway.broadcastHedgingAlert).toHaveBeenCalledTimes(1);
      expect(push.notifyHedgingActivated).toHaveBeenCalledTimes(1);
      const trigger = push.notifyHedgingActivated.mock.calls[0][0];
      expect(gateway.broadcastExecutionNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          correlationId: trigger.correlationId,
          simulated: true,
          filledQuantity: 0,
        }),
      );
      expect(
        module.get(PipelineLatencyService).snapshot().segments.total.count,
      ).toBe(2);
    } finally {
      await module.close();
      if (previousMode === undefined) delete process.env.EXECUTION_MODE;
      else process.env.EXECUTION_MODE = previousMode;
    }
  });
});
