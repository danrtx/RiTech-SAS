import { runLatencyBenchmark } from './latency-benchmark';

/** Carga corta y repetible en CI; el reporte completo se genera con `npm run qa:latency`. */
describe('NFR-001: latencia ingesta → hedging bajo carga', () => {
  it('entrega cada tick al motor por debajo de 200 ms y mide todos los tramos', async () => {
    const report = await runLatencyBenchmark({
      ratePerSecond: 200,
      durationMs: 1500,
      batchSize: 5,
      cache: 'memory',
    });
    expect(report.data.dropped).toBe(0);
    expect(report.data.measured).toBe(report.data.ticksSent);
    expect(report.result.segments.total.p50).not.toBeNull();
    expect(report.result.segments.total.p95).not.toBeNull();
    expect(report.result.segments.total.max).toBeLessThanOrEqual(200);
    expect(report.result.slowestSegment).not.toBeNull();
    expect(report.verdict).toBe('PASS');
  });
});
