/**
 * Medición de latencia entre la ingesta de precios y el motor de hedging (requisito NFR-001).
 *
 * Cada tick en vivo lleva una traza con marcas de tiempo monotónicas. Al llegar al motor
 * de stop-loss se calcula cuánto tardó cada tramo del camino y se acumulan estadísticas
 * (p50, p95, máximo y promedio) que expone `GET /hedging/latency`.
 */
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
/** Tramos parciales: candidatos a "tramo más lento" (el total no cuenta). */
const STAGES = PIPELINE_SEGMENTS.filter((segment) => segment !== 'total');

/** Marcas de tiempo que viajan con cada tick en vivo desde la ingesta hasta hedging. */
export interface PipelineTrace {
  /** performance.now() al recibir el frame del proveedor. */
  readonly receivedAtMonotonicMs: number;
  /** performance.now() al iniciar la entrega al consumidor. */
  readonly consumedAtMonotonicMs: number;
}

/** Estadísticas de un tramo, en milisegundos. `null` mientras no haya muestras. */
export interface SegmentSummary {
  /** Total de muestras registradas desde el arranque (no solo las de la ventana). */
  readonly count: number;
  /** Mediana sobre la ventana de muestras recientes. */
  readonly p50: number | null;
  /** Percentil 95 sobre la ventana de muestras recientes. */
  readonly p95: number | null;
  /** Máximo histórico desde el arranque o el último reset. */
  readonly max: number | null;
  /** Promedio histórico desde el arranque o el último reset. */
  readonly average: number | null;
}

/** Respuesta de `GET /hedging/latency`. */
export interface PipelineLatencySnapshot {
  readonly budgetMs: number;
  /** Cuántas muestras recientes se usan para los percentiles (máximo 4096). */
  readonly sampleWindow: number;
  /** `true` si el máximo total nunca superó el presupuesto; `null` sin datos. */
  readonly withinBudget: boolean | null;
  /** Cantidad de ticks cuyo total superó los 200 ms. */
  readonly budgetExceeded: number;
  /** Tramo (sin contar total) con mayor p95: identifica el módulo que introduce retraso. */
  readonly slowestSegment: PipelineSegment | null;
  readonly segments: Readonly<Record<PipelineSegment, SegmentSummary>>;
}

/**
 * Percentil por rango más cercano sobre una copia ordenada.
 * Ejemplo: con 100 muestras, p95 devuelve la muestra en la posición 95.
 */
export function percentile(sorted: readonly number[], p: number): number | null {
  if (!sorted.length) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

/** Calcula el resumen de un tramo a partir de su ventana y sus acumulados. */
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

/** Estado interno por tramo: ventana deslizante más acumulados históricos. */
interface SegmentState {
  samples: number[];
  count: number;
  total: number;
  max: number;
}

/**
 * Acumula la latencia por tramo. StopLossService llama a `record` cuando una muestra
 * llega al motor, y el controlador `PipelineLatencyController` expone `snapshot()`.
 */
@Injectable()
export class PipelineLatencyService {
  private readonly state = new Map<PipelineSegment, SegmentState>();
  private budgetExceeded = 0;
  /** Muestras recientes que se conservan por tramo para calcular percentiles. */
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
    // Una traza corrupta (NaN o infinito) se descarta en lugar de ensuciar las estadísticas.
    if (!Object.values(values).every(Number.isFinite)) return;
    for (const segment of PIPELINE_SEGMENTS) {
      // Un valor negativo solo puede venir de relojes desalineados: se cuenta como 0.
      const value = Math.max(0, values[segment]);
      const entry = this.state.get(segment)!;
      entry.samples.push(value);
      // Ventana deslizante: se descarta la muestra más antigua al superar el tamaño.
      if (entry.samples.length > this.windowSize) entry.samples.shift();
      entry.count++;
      entry.total += value;
      entry.max = Math.max(entry.max, value);
    }
    if (values.total > PIPELINE_LATENCY_BUDGET_MS) this.budgetExceeded++;
  }

  /** Foto actual de las estadísticas para el endpoint y los reportes. */
  snapshot(): PipelineLatencySnapshot {
    const segments = Object.fromEntries(
      PIPELINE_SEGMENTS.map((segment) => {
        const { samples, count, total, max } = this.state.get(segment)!;
        return [segment, summarize(samples, count, total, max)];
      }),
    ) as Record<PipelineSegment, SegmentSummary>;
    const total = segments.total;
    // El tramo con mayor p95 es el que más aporta a la latencia típica alta.
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

  /** Borra todas las muestras y contadores (útil en pruebas y benchmarks). */
  reset(): void {
    for (const segment of PIPELINE_SEGMENTS)
      this.state.set(segment, { samples: [], count: 0, total: 0, max: 0 });
    this.budgetExceeded = 0;
  }
}
