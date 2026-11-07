import { Injectable } from '@nestjs/common';

/** NFR-001: la comunicación en memoria ingesta → hedging no debe superar 200 ms. */
export const PIPELINE_LATENCY_BUDGET_MS = 200;

/**
 * Tramos medidos con reloj monotónico (performance.now) desde la recepción del frame:
 * - ingestionQueue: espera en la cola del MarketDataProcessor hasta el consumidor.
 * - consumerProcessing: caché + análisis en MarketAtrConsumer hasta encolar en hedging.
 * - hedgingQueue: cola de StopLossService hasta que el motor recibe la muestra.
 * - total: recepción del frame → muestra disponible para el motor.
 */
export const PIPELINE_SEGMENTS = [
  'ingestionQueue',
  'consumerProcessing',
  'hedgingQueue',
  'total',
] as const;
export type PipelineSegment = (typeof PIPELINE_SEGMENTS)[number];
const STAGES = PIPELINE_SEGMENTS.filter((segment) => segment !== 'total');

export interface PipelineTrace {
  /** performance.now() al recibir el frame del proveedor. */
  readonly receivedAtMonotonicMs: number;
  /** performance.now() al iniciar la entrega al consumidor. */
  readonly consumedAtMonotonicMs: number;
}

export interface SegmentSummary {
  readonly count: number;
  readonly p50: number | null;
  readonly p95: number | null;
  readonly max: number | null;
  readonly average: number | null;
}

export interface PipelineLatencySnapshot {
  readonly budgetMs: number;
  readonly sampleWindow: number;
  readonly withinBudget: boolean | null;
  readonly budgetExceeded: number;
  /** Tramo (sin contar total) con mayor p95: identifica el módulo que introduce retraso. */
  readonly slowestSegment: PipelineSegment | null;
  readonly segments: Readonly<Record<PipelineSegment, SegmentSummary>>;
}

/** Percentil por rango más cercano sobre una copia ordenada. */
export function percentile(sorted: readonly number[], p: number): number | null {
  if (!sorted.length) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

function summarize(samples: readonly number[], count: number, total: number, max: number): SegmentSummary {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    count,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: count ? max : null,
    average: count ? total / count : null,
  };
}

interface SegmentState {
  samples: number[];
  count: number;
  total: number;
  max: number;
}

@Injectable()
export class PipelineLatencyService {
  private readonly state = new Map<PipelineSegment, SegmentState>();
  private budgetExceeded = 0;
  private readonly windowSize = 4096;

  constructor() {
    this.reset();
  }

  /** Registra los tres tramos y el total; no lanza: la medición nunca bloquea el trading. */
  record(trace: PipelineTrace, enqueuedAtMs: number, availableAtMs: number): void {
    const values: Record<PipelineSegment, number> = {
      ingestionQueue: trace.consumedAtMonotonicMs - trace.receivedAtMonotonicMs,
      consumerProcessing: enqueuedAtMs - trace.consumedAtMonotonicMs,
      hedgingQueue: availableAtMs - enqueuedAtMs,
      total: availableAtMs - trace.receivedAtMonotonicMs,
    };
    if (!Object.values(values).every(Number.isFinite)) return;
    for (const segment of PIPELINE_SEGMENTS) {
      const value = Math.max(0, values[segment]);
      const entry = this.state.get(segment)!;
      entry.samples.push(value);
      if (entry.samples.length > this.windowSize) entry.samples.shift();
      entry.count++;
      entry.total += value;
      entry.max = Math.max(entry.max, value);
    }
    if (values.total > PIPELINE_LATENCY_BUDGET_MS) this.budgetExceeded++;
  }

  snapshot(): PipelineLatencySnapshot {
    const segments = Object.fromEntries(
      PIPELINE_SEGMENTS.map((segment) => {
        const { samples, count, total, max } = this.state.get(segment)!;
        return [segment, summarize(samples, count, total, max)];
      }),
    ) as Record<PipelineSegment, SegmentSummary>;
    const total = segments.total;
    let slowestSegment: PipelineSegment | null = null;
    for (const segment of STAGES) {
      const p95 = segments[segment].p95;
      if (p95 === null) continue;
      if (slowestSegment === null || p95 > segments[slowestSegment].p95!)
        slowestSegment = segment;
    }
    return {
      budgetMs: PIPELINE_LATENCY_BUDGET_MS,
      sampleWindow: this.state.get('total')!.samples.length,
      withinBudget: total.count ? total.max! <= PIPELINE_LATENCY_BUDGET_MS : null,
      budgetExceeded: this.budgetExceeded,
      slowestSegment,
      segments,
    };
  }

  reset(): void {
    for (const segment of PIPELINE_SEGMENTS)
      this.state.set(segment, { samples: [], count: 0, total: 0, max: 0 });
    this.budgetExceeded = 0;
  }
}
