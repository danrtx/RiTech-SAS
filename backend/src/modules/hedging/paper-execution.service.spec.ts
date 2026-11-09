import { PaperExecutionService } from './paper-execution.service';
import { TelemetryGateway } from '../telemetry/telemetry.gateway';
import { DynamicStopLoss } from './dynamic-stop-loss';
describe('paper execution', () => {
  const oldMode = process.env.EXECUTION_MODE;
  afterEach(() => {
    if (oldMode === undefined) delete process.env.EXECUTION_MODE;
    else process.env.EXECUTION_MODE = oldMode;
  });
  it('requires explicit paper mode and deduplicates accepted signals', () => {
    const broadcastExecutionNotification = jest.fn();
    const service = new PaperExecutionService({ broadcastExecutionNotification } as unknown as TelemetryGateway);
    const engine = new DynamicStopLoss();
    engine.accept({ symbol: 'QQQ', price: 100, eventTimeMs: 0 }, 0);
    const trigger = engine.accept({ symbol: 'QQQ', price: 99, eventTimeMs: 1000 }, 1000)[0];
    delete process.env.EXECUTION_MODE;
    service.execute(trigger);
    expect(broadcastExecutionNotification).not.toHaveBeenCalled();
    process.env.EXECUTION_MODE = 'paper';
    service.execute(trigger); service.execute(trigger);
    expect(broadcastExecutionNotification).toHaveBeenCalledTimes(1);
    expect(broadcastExecutionNotification).toHaveBeenCalledWith(expect.objectContaining({ simulated: true, filledQuantity: 0, correlationId: trigger.correlationId }));
  });
});
