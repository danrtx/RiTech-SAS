import {
  PIPELINE_LATENCY_BUDGET_MS,
  PipelineLatencyService,
  percentile,
} from './pipeline-latency';
import { StopLossService } from './stop-loss.service';
import { TelemetryGateway } from '../telemetry/telemetry.gateway';

/**
 * Pruebas unitarias de la medición de latencia: cálculo de percentiles, separación por
 * tramos, detección del presupuesto de 200 ms y registro desde StopLossService.
 */
describe('PipelineLatencyService (NFR-001)', () => {
  it('calcula percentiles por rango más cercano', () => {
    const sorted = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(sorted, 50)).toBe(50);
    expect(percentile(sorted, 95)).toBe(95);
    expect(percentile([7], 95)).toBe(7);
    expect(percentile([], 50)).toBeNull();
  });

  it('separa los tramos e identifica el que introduce retraso', () => {
    const latency = new PipelineLatencyService();
    for (let i = 0; i < 20; i++)
      latency.record(
        { receivedAtMonotonicMs: 0, consumedAtMonotonicMs: 1 },
        1 + 30 + i,
        1 + 30 + i + 2,
      );
    const snapshot = latency.snapshot();
    expect(snapshot.segments.ingestionQueue).toMatchObject({ count: 20, p50: 1, max: 1 });
    // 30..49 ms: el rango 95 de 20 muestras es la posición 19.
    expect(snapshot.segments.consumerProcessing.p95).toBe(48);
    expect(snapshot.segments.consumerProcessing.max).toBe(49);
    expect(snapshot.segments.hedgingQueue.max).toBe(2);
    expect(snapshot.segments.total.max).toBe(52);
    expect(snapshot.slowestSegment).toBe('consumerProcessing');
    expect(snapshot.withinBudget).toBe(true);
    expect(snapshot.budgetExceeded).toBe(0);
  });

  it('marca el incumplimiento del presupuesto de 200 ms', () => {
    const latency = new PipelineLatencyService();
    latency.record({ receivedAtMonotonicMs: 0, consumedAtMonotonicMs: 150 }, 160, 201);
    const snapshot = latency.snapshot();
    expect(snapshot.budgetMs).toBe(PIPELINE_LATENCY_BUDGET_MS);
    expect(snapshot.withinBudget).toBe(false);
    expect(snapshot.budgetExceeded).toBe(1);
    expect(snapshot.slowestSegment).toBe('ingestionQueue');
  });

  it('sin muestras no afirma cumplimiento', () => {
    const snapshot = new PipelineLatencyService().snapshot();
    expect(snapshot.withinBudget).toBeNull();
    expect(snapshot.slowestSegment).toBeNull();
    expect(snapshot.segments.total).toEqual({
      count: 0,
      p50: null,
      p95: null,
      max: null,
      average: null,
    });
  });

  it('ignora trazas no finitas y relojes que retroceden quedan en cero', () => {
    const latency = new PipelineLatencyService();
    latency.record({ receivedAtMonotonicMs: NaN, consumedAtMonotonicMs: 1 }, 2, 3);
    expect(latency.snapshot().segments.total.count).toBe(0);
    latency.record({ receivedAtMonotonicMs: 10, consumedAtMonotonicMs: 5 }, 6, 12);
    expect(latency.snapshot().segments.ingestionQueue.max).toBe(0);
  });

  it('StopLossService registra la traza al entregar la muestra al motor', async () => {
    const latency = new PipelineLatencyService();
    const service = new StopLossService(
      { broadcastHedgingAlert: jest.fn() } as unknown as TelemetryGateway,
      latency,
    );
    const now = performance.now();
    service.enqueue(
      { symbol: 'QQQ', price: 100, eventTimeMs: Date.now() },
      { receivedAtMonotonicMs: now - 3, consumedAtMonotonicMs: now - 1 },
    );
    service.enqueue({ symbol: 'QQQ', price: 100, eventTimeMs: Date.now() + 1 });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const snapshot = latency.snapshot();
    // La muestra sin traza (recuperación o consumidor directo) no se mide.
    expect(snapshot.segments.total.count).toBe(1);
    expect(snapshot.segments.ingestionQueue.max).toBeCloseTo(2, 0);
    expect(snapshot.segments.total.max).toBeGreaterThanOrEqual(3);
    service.onModuleDestroy();
  });
});
