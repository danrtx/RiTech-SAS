/**
 * Benchmark de carga para NFR-001 (latencia ingesta → hedging ≤ 200 ms).
 *
 * Inyecta trades sintéticos a ritmo constante en el pipeline real del backend y devuelve
 * un reporte con configuración, datos y resultados por tramo. Lo usan la prueba corta
 * `latency-benchmark.spec.ts` (CI) y el script `npm run qa:latency` (reporte completo).
 */
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { performance } from 'node:perf_hooks';
import { ConfigService } from '@nestjs/config';
import { RedisCacheService } from '../modules/redis-cache/redis-cache.service';
import { AtrConfig, defaultAtrOptions } from '../modules/atr/atr.config';
import { AlpacaAdapter } from '../modules/market-data/adapters/alpaca.adapter';
import { MarketDataProcessor } from '../modules/market-data/market-data.processor';
import { MarketAtrConsumer } from '../modules/market-data/market-atr.consumer';
import { parseMarketDataConfig } from '../modules/market-data/market-data.config';
import { PriceAnalysisService } from '../modules/market-data/analysis/price-analysis.service';
import { InvestmentAnalysisService } from '../modules/hedging/investment-analysis.service';
import { StopLossService } from '../modules/hedging/stop-loss.service';
import {
  PipelineLatencyService,
  PipelineLatencySnapshot,
} from '../modules/hedging/pipeline-latency';
import { IngestionState } from '../modules/market-data/ingestion.state';
import { MarketClock } from '../modules/market-data/market.types';
import type { AtrService } from '../modules/atr/atr.service';
import type { TelemetryGateway } from '../modules/telemetry/telemetry.gateway';

/** Parámetros de la carga simulada. */
export interface LatencyBenchmarkOptions {
  /** Ticks por segundo entregados al procesador. */
  readonly ratePerSecond: number;
  /** Duración de la carga en milisegundos. */
  readonly durationMs: number;
  /** Ticks por frame WebSocket (los proveedores agrupan trades en un mismo mensaje). */
  readonly batchSize: number;
  /**
   * `memory`: caché en memoria (aísla el costo del código).
   * `redis`: RedisCacheService real con prefijo temporal (incluye el viaje de red a Redis).
   */
  readonly cache: 'memory' | 'redis';
}

/** Reporte reproducible: se guarda como JSON y Markdown en reportes/latencia/. */
export interface LatencyBenchmarkReport {
  readonly requirement: 'NFR-001';
  readonly generatedAt: string;
  readonly environment: {
    readonly node: string;
    readonly platform: string;
    readonly arch: string;
  };
  readonly configuration: LatencyBenchmarkOptions & {
    readonly pipeline: string;
    readonly substitutes: readonly string[];
  };
  readonly data: {
    readonly ticksSent: number;
    readonly framesSent: number;
    /** Ticks que el procesador entregó al consumidor. */
    readonly delivered: number;
    /** Ticks que llegaron al motor de hedging con traza (los que entran a las estadísticas). */
    readonly measured: number;
    /** Ticks perdidos en el camino; debe ser 0 para que la medición sea válida. */
    readonly dropped: number;
    readonly pattern: string;
  };
  readonly result: PipelineLatencySnapshot;
  /** PASS si ningún tick superó los 200 ms de punta a punta. */
  readonly verdict: 'PASS' | 'FAIL';
}

/** Carga por defecto: 200 ticks/s durante 10 s, en frames de 5 ticks, sin Redis. */
export const DEFAULT_BENCHMARK: LatencyBenchmarkOptions = {
  ratePerSecond: 200,
  durationMs: 10_000,
  batchSize: 5,
  cache: 'memory',
};

/** Gateway Socket.IO falso: cualquier método existe y no hace nada (no hay clientes). */
const silentGateway = new Proxy(
  {},
  { get: () => () => undefined },
) as unknown as TelemetryGateway;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Crea la caché según el modo: un doble en memoria que acepta todo, o el RedisCacheService
 * real con un prefijo único para no tocar datos existentes. `close` libera y limpia.
 */
async function createCache(kind: LatencyBenchmarkOptions['cache'], symbol: string) {
  if (kind === 'memory')
    return {
      cache: {
        appendTick: async () => ({ accepted: true }),
        advanceCoverage: async () => undefined,
      } as unknown as RedisCacheService,
      close: async () => undefined,
    };
  const atrConfig = {
    options: { ...defaultAtrOptions, symbols: [symbol], prefix: `ritech:bench:${randomUUID()}` },
  } as AtrConfig;
  const cache = new RedisCacheService(
    new ConfigService({
      REDIS_HOST: process.env.REDIS_HOST ?? '127.0.0.1',
      REDIS_PORT: Number(process.env.REDIS_PORT ?? 6379),
      REDIS_PASS: process.env.REDIS_PASSWORD ?? 'ritech_dev',
    }),
    atrConfig,
    new MarketClock(),
  );
  cache.onModuleInit();
  await once(cache.getClient(), 'ready');
  return {
    cache,
    close: async () => {
      // Solo se borran las claves del prefijo temporal del benchmark.
      const keys = cache.keys(symbol);
      if (keys.length) await cache.getClient().del(...keys);
      cache.onModuleDestroy();
    },
  };
}

/**
 * Recorre el camino productivo en memoria: AlpacaAdapter → MarketDataProcessor →
 * MarketAtrConsumer → PriceAnalysisService → StopLossService → DynamicStopLoss.
 * ATR y Socket.IO se sustituyen por dobles; Redis también, salvo con `cache: 'redis'`,
 * que incluye el viaje de red real a Redis en el tramo consumerProcessing.
 */
export async function runLatencyBenchmark(
  options: Partial<LatencyBenchmarkOptions> = {},
): Promise<LatencyBenchmarkReport> {
  const opts = { ...DEFAULT_BENCHMARK, ...options };
  // Feed mock de Alpaca con cola amplia, para que la cola no descarte ticks durante la carga.
  const config = parseMarketDataConfig({
    MARKET_DATA_PROVIDER: 'alpaca',
    MARKET_DATA_ENABLED: 'true',
    MARKET_DATA_FEED: 'mock',
    MARKET_DATA_QUEUE_CAPACITY: '10000',
  });
  const { cache, close } = await createCache(opts.cache, config.symbol);
  const atr = {
    invalidateSymbol: () => undefined,
    suspendSymbol: () => undefined,
  } as unknown as AtrService;
  // Se arma el mismo grafo de objetos que NestJS crea en producción, sin el contenedor.
  const latency = new PipelineLatencyService();
  const stopLoss = new StopLossService(silentGateway, latency);
  const analysis = new PriceAnalysisService(config, silentGateway, new InvestmentAnalysisService());
  const consumer = new MarketAtrConsumer(
    config,
    { options: { ...defaultAtrOptions, symbols: [config.symbol] } } as AtrConfig,
    cache,
    atr,
    analysis,
    new IngestionState(),
    new MarketClock(),
    stopLoss,
  );
  const processor = new MarketDataProcessor(config, new AlpacaAdapter(config), consumer);
  processor.setLive(true);

  // Ejemplo: 200 ticks/s en frames de 5 → un frame cada 25 ms.
  const frames = Math.max(1, Math.round((opts.ratePerSecond * opts.durationMs) / 1000 / opts.batchSize));
  const intervalMs = (opts.batchSize * 1000) / opts.ratePerSecond;
  const start = performance.now();
  let id = 0;
  for (let frame = 0; frame < frames; frame++) {
    // Cada frame se programa respecto al inicio, así un retraso no se acumula en los siguientes.
    const due = start + frame * intervalMs;
    const wait = due - performance.now();
    if (wait > 0) await sleep(wait);
    const nowMs = Date.now();
    const messages = Array.from({ length: opts.batchSize }, () => ({
      T: 't' as const,
      S: config.symbol,
      i: ++id,
      x: 'V',
      // Serie sintética oscilante alrededor de 500 USD; no son cotizaciones reales.
      p: 500 + Math.sin(id / 50) * 2,
      s: 10,
      c: ['@'],
      // Fracción sub-milisegundo creciente: mantiene el orden por nanosegundos del procesador.
      t: new Date(nowMs).toISOString().replace('Z', `${String(id % 1_000_000).padStart(6, '0')}Z`),
      z: 'C',
    }));
    // Igual que el cliente WebSocket real: la marca monotónica inicia la medición.
    processor.accept({
      messages,
      receivedAtMs: nowMs,
      receivedAtMonotonicMs: performance.now(),
    });
  }
  // Se espera a que el procesador y la cola del stop-loss terminen antes de leer resultados.
  await processor.whenIdle();
  await new Promise<void>((resolve) => setImmediate(resolve));
  stopLoss.onModuleDestroy();
  processor.setLive(false);
  await close();

  const status = processor.getStatus();
  const result = latency.snapshot();
  return {
    requirement: 'NFR-001',
    generatedAt: new Date().toISOString(),
    environment: { node: process.version, platform: process.platform, arch: process.arch },
    configuration: {
      ...opts,
      pipeline:
        'AlpacaAdapter → MarketDataProcessor → MarketAtrConsumer → PriceAnalysisService → StopLossService → DynamicStopLoss',
      substitutes: [
        opts.cache === 'redis'
          ? 'Redis: instancia real con prefijo temporal (se elimina al terminar)'
          : 'Redis: caché en memoria (sin red)',
        'ATR: doble sin cálculo',
        'Socket.IO: gateway sin clientes',
      ],
    },
    data: {
      ticksSent: id,
      framesSent: frames,
      delivered: status.delivered,
      measured: result.segments.total.count,
      dropped: status.dropped,
      pattern: 'Trades sintéticos QQQ, precio 500 ± 2 USD (seno), timestamps del reloj local',
    },
    result,
    verdict: result.withinBudget ? 'PASS' : 'FAIL',
  };
}
